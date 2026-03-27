"""
Monte Carlo simulation tests.
Validates structure, percentile ordering, and probability bounds.
"""
import pytest
from monte_carlo import run_monte_carlo


class TestMonteCarloStructure:
    """Test that 20-sim MC returns correct structure."""

    def setup_method(self):
        self.result = run_monte_carlo(inputs={}, num_sims=20)

    def test_returns_years_array(self):
        assert "years" in self.result
        assert len(self.result["years"]) > 0

    def test_returns_deterministic(self):
        assert "deterministic" in self.result
        det = self.result["deterministic"]
        assert "nw" in det
        assert "inv" in det
        assert len(det["nw"]) == len(self.result["years"])

    def test_returns_percentiles(self):
        assert "percentiles" in self.result
        pcts = self.result["percentiles"]
        for key in ["p10", "p25", "p50", "p75", "p90"]:
            assert key in pcts, f"Missing percentile {key}"
            assert "nw" in pcts[key]
            assert len(pcts[key]["nw"]) == len(self.result["years"])

    def test_returns_probabilities(self):
        assert "probabilities" in self.result
        probs = self.result["probabilities"]
        for key in ["hit_1m", "hit_2m", "hit_5m", "hit_8m"]:
            assert key in probs, f"Missing probability {key}"
            assert 0 <= probs[key] <= 1, f"{key} = {probs[key]} out of [0,1]"
        assert "terminal_mean" in probs
        assert "terminal_median" in probs

    def test_num_sims_reported(self):
        assert self.result["num_sims"] == 20

    def test_elapsed_ms_positive(self):
        assert self.result["elapsed_ms"] > 0


class TestPercentileOrdering:
    """P10 < P50 < P90 for every year."""

    def setup_method(self):
        self.result = run_monte_carlo(inputs={}, num_sims=20)

    def test_p10_less_than_p50(self):
        p10 = self.result["percentiles"]["p10"]["nw"]
        p50 = self.result["percentiles"]["p50"]["nw"]
        years = self.result["years"]
        for i in range(len(years)):
            assert p10[i] <= p50[i], \
                f"P10 ({p10[i]:,.0f}) > P50 ({p50[i]:,.0f}) in year {years[i]}"

    def test_p50_less_than_p90(self):
        p50 = self.result["percentiles"]["p50"]["nw"]
        p90 = self.result["percentiles"]["p90"]["nw"]
        years = self.result["years"]
        for i in range(len(years)):
            assert p50[i] <= p90[i], \
                f"P50 ({p50[i]:,.0f}) > P90 ({p90[i]:,.0f}) in year {years[i]}"

    def test_p25_between_p10_and_p75(self):
        p10 = self.result["percentiles"]["p10"]["nw"]
        p25 = self.result["percentiles"]["p25"]["nw"]
        p75 = self.result["percentiles"]["p75"]["nw"]
        years = self.result["years"]
        for i in range(len(years)):
            assert p10[i] <= p25[i] <= p75[i], \
                f"P25 not between P10 and P75 in year {years[i]}"


class TestProbabilityConsistency:
    """Higher thresholds should have lower probabilities."""

    def setup_method(self):
        self.result = run_monte_carlo(inputs={}, num_sims=20)

    def test_probability_ordering(self):
        probs = self.result["probabilities"]
        assert probs["hit_1m"] >= probs["hit_2m"], \
            f"P($1M)={probs['hit_1m']} < P($2M)={probs['hit_2m']}"
        assert probs["hit_2m"] >= probs["hit_5m"], \
            f"P($2M)={probs['hit_2m']} < P($5M)={probs['hit_5m']}"
        assert probs["hit_5m"] >= probs["hit_8m"], \
            f"P($5M)={probs['hit_5m']} < P($8M)={probs['hit_8m']}"

    def test_terminal_mean_positive(self):
        assert self.result["probabilities"]["terminal_mean"] > 0

    def test_terminal_median_positive(self):
        assert self.result["probabilities"]["terminal_median"] > 0


class TestMonteCarloAPI:
    """Test MC via the API endpoint."""

    def test_monte_carlo_endpoint(self, client):
        res = client.post("/monte-carlo", json={
            "num_sims": 20,
            "annual_vol": 0.16,
            "inputs": {},
        })
        assert res.status_code == 200
        data = res.json()
        assert data["num_sims"] == 20
        assert len(data["years"]) > 0
        assert "percentiles" in data

    def test_custom_inputs_accepted(self, client):
        res = client.post("/monte-carlo", json={
            "num_sims": 10,
            "annual_vol": 0.16,
            "inputs": {"retire_age": 55, "inflation": 0.03},
        })
        assert res.status_code == 200
