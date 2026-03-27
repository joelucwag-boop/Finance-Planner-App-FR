"""
Monte Carlo Simulation Module
Runs N parallel simulations of the financial engine with randomized
investment returns drawn from a log-normal distribution.

Returns percentile bands (P10, P25, P50, P75, P90) for yearly net worth,
plus probability metrics ("X% chance of hitting $Y by age Z").

Performance: ~200 sims in ~4 seconds on a single core.
Uses ProcessPoolExecutor for parallelism when available.
"""
import math
import random
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Dict, List, Optional

from engine import run_engine


# ── Return Distribution Parameters ──
# Based on historical S&P 500 data (1926-2023):
#   Geometric mean: ~10.1% nominal, ~7% real
#   Annual volatility: ~16%
# We model monthly log-returns as normal, which gives log-normal price paths.
DEFAULT_ANNUAL_RETURN = 0.07   # Expected annual real return (matches v13 baseline)
DEFAULT_ANNUAL_VOL = 0.16      # Annual standard deviation of returns
NUM_MONTHS = 528               # Jun 2026 → Dec 2069 = 43.5 years × 12


def generate_monthly_returns(
    annual_return: float = DEFAULT_ANNUAL_RETURN,
    annual_vol: float = DEFAULT_ANNUAL_VOL,
    num_months: int = NUM_MONTHS,
    seed: Optional[int] = None,
) -> List[float]:
    """
    Generate a sequence of random monthly investment returns.

    Uses log-normal model: monthly log-returns are N(mu, sigma^2) where
      mu = (log(1 + annual_return) - 0.5 * annual_vol^2) / 12
      sigma = annual_vol / sqrt(12)

    Returns a list of monthly rates (e.g., 0.005 = +0.5% that month).
    These get plugged into run_engine via the _monthly_returns key.
    """
    if seed is not None:
        rng = random.Random(seed)
    else:
        rng = random.Random()

    # Convert annual parameters to monthly log-normal parameters
    monthly_sigma = annual_vol / math.sqrt(12)
    # Adjust mu so the expected geometric return matches the target
    monthly_mu = (math.log(1 + annual_return) - 0.5 * annual_vol ** 2) / 12

    returns = []
    for _ in range(num_months):
        # Draw a monthly log-return from the normal distribution
        log_return = rng.gauss(monthly_mu, monthly_sigma)
        # Convert to a simple monthly rate (what the engine expects)
        monthly_rate = math.exp(log_return) - 1
        returns.append(monthly_rate)

    return returns


def _run_single_sim(args: tuple) -> List[float]:
    """
    Worker function for parallel execution.
    Runs one simulation and returns yearly NW values.
    """
    inputs, seed = args
    monthly_returns = generate_monthly_returns(
        annual_return=inputs.get("inv_return", DEFAULT_ANNUAL_RETURN),
        annual_vol=inputs.get("_annual_vol", DEFAULT_ANNUAL_VOL),
        num_months=NUM_MONTHS,
        seed=seed,
    )

    # Inject random returns into engine inputs
    sim_inputs = dict(inputs)
    sim_inputs["_monthly_returns"] = monthly_returns

    # Run the engine
    result = run_engine(sim_inputs)

    # Extract just the yearly NW values (that's all we need for bands)
    yearly_nw = [yr["nw"] for yr in result["yearly"]]
    yearly_inv = [yr.get("inv", yr.get("k401", 0) + yr.get("tsp", 0) + yr.get("roth", 0) + yr.get("brok", 0)) for yr in result["yearly"]]

    return yearly_nw, yearly_inv


def run_monte_carlo(
    inputs: dict,
    num_sims: int = 200,
    max_workers: int = 4,
) -> dict:
    """
    Run Monte Carlo simulation.

    Args:
        inputs: Same dict as run_engine (all ~80 parameters)
        num_sims: Number of simulations (default 200, max 1000)
        max_workers: Number of parallel processes

    Returns:
        {
            "num_sims": 200,
            "elapsed_ms": 4200,
            "years": [2026, 2027, ...],
            "deterministic": {"nw": [...], "inv": [...]},
            "percentiles": {
                "p10":  {"nw": [...], "inv": [...]},
                "p25":  {"nw": [...], "inv": [...]},
                "p50":  {"nw": [...], "inv": [...]},
                "p75":  {"nw": [...], "inv": [...]},
                "p90":  {"nw": [...], "inv": [...]},
            },
            "probabilities": {
                "hit_1m": 0.85,      # % of sims reaching $1M
                "hit_2m": 0.72,
                "hit_5m": 0.45,
                "hit_8m": 0.22,
                "terminal_mean": 8500000,
                "terminal_median": 7200000,
            }
        }
    """
    num_sims = min(num_sims, 1000)  # safety cap
    t0 = time.perf_counter()

    # First, run the deterministic baseline (no randomness)
    det_result = run_engine(inputs)
    det_nw = [yr["nw"] for yr in det_result["yearly"]]
    det_inv = [yr.get("inv", yr.get("k401", 0) + yr.get("tsp", 0) + yr.get("roth", 0) + yr.get("brok", 0)) for yr in det_result["yearly"]]
    years = [yr["yr"] for yr in det_result["yearly"]]
    num_years = len(years)

    # Generate unique seeds for reproducibility per-run
    base_seed = random.randint(0, 2**31)
    sim_args = [(inputs, base_seed + i) for i in range(num_sims)]

    # Run simulations (parallel if possible, sequential fallback)
    all_nw = []    # list of lists: [sim_i][year_j] = nw
    all_inv = []

    try:
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_run_single_sim, arg) for arg in sim_args]
            for f in as_completed(futures):
                nw_path, inv_path = f.result()
                all_nw.append(nw_path)
                all_inv.append(inv_path)
    except Exception:
        # Fallback to sequential if multiprocessing fails (e.g., on some platforms)
        for arg in sim_args:
            nw_path, inv_path = _run_single_sim(arg)
            all_nw.append(nw_path)
            all_inv.append(inv_path)

    # ── Compute percentiles for each year ──
    def percentile_at(data_matrix, pct, year_idx):
        """Get the p-th percentile of values at year_idx across all sims."""
        vals = sorted(row[year_idx] for row in data_matrix if year_idx < len(row))
        if not vals:
            return 0
        k = (len(vals) - 1) * pct / 100
        f = int(k)
        c = f + 1 if f + 1 < len(vals) else f
        d = k - f
        return vals[f] + d * (vals[c] - vals[f])

    pct_levels = [10, 25, 50, 75, 90]
    percentiles = {}
    for p in pct_levels:
        percentiles[f"p{p}"] = {
            "nw": [round(percentile_at(all_nw, p, j)) for j in range(num_years)],
            "inv": [round(percentile_at(all_inv, p, j)) for j in range(num_years)],
        }

    # ── Probability metrics ──
    terminal_nws = [row[-1] for row in all_nw if row]
    terminal_nws.sort()
    n = len(terminal_nws)

    def prob_above(threshold):
        """Fraction of simulations ending above threshold."""
        count = sum(1 for x in terminal_nws if x >= threshold)
        return round(count / max(n, 1), 3)

    terminal_mean = round(sum(terminal_nws) / max(n, 1))
    terminal_median = terminal_nws[n // 2] if n > 0 else 0

    elapsed_ms = round((time.perf_counter() - t0) * 1000)

    return {
        "num_sims": num_sims,
        "elapsed_ms": elapsed_ms,
        "years": years,
        "deterministic": {
            "nw": [round(x) for x in det_nw],
            "inv": [round(x) for x in det_inv],
        },
        "percentiles": percentiles,
        "probabilities": {
            "hit_1m": prob_above(1_000_000),
            "hit_2m": prob_above(2_000_000),
            "hit_5m": prob_above(5_000_000),
            "hit_8m": prob_above(8_000_000),
            "terminal_mean": terminal_mean,
            "terminal_median": round(terminal_median),
        },
    }
