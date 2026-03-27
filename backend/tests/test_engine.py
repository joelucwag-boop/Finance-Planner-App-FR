"""
Engine regression tests.
Validates the 523-month simulation produces expected outputs.
"""
import pytest
from engine import run_engine


class TestBaseline:
    """Baseline simulation with all defaults."""

    def setup_method(self):
        self.result = run_engine({})
        self.monthly = self.result["monthly"]
        self.yearly = self.result["yearly"]

    def test_produces_523_months(self):
        assert len(self.monthly) == 523

    def test_produces_44_years(self):
        assert len(self.yearly) == 44

    def test_first_month_is_june_2026(self):
        first = self.monthly[0]
        assert first[0] == 2026  # year
        assert first[1] == 6     # month

    def test_last_month_is_dec_2069(self):
        last = self.monthly[-1]
        assert last[0] == 2069
        assert last[1] == 12

    def test_terminal_net_worth(self):
        """2069 NW should be $8,507,266 ± $1 (regression anchor)."""
        final_yr = self.yearly[-1]
        assert final_yr["yr"] == 2069
        assert abs(final_yr["nw"] - 8507266) <= 1

    def test_yearly_net_worth_monotonic_from_2035(self):
        """After debts are paid and assets compound, NW should grow each year from ~2035."""
        nw_from_2035 = [y["nw"] for y in self.yearly if y["yr"] >= 2035]
        for i in range(1, len(nw_from_2035)):
            assert nw_from_2035[i] >= nw_from_2035[i - 1], \
                f"NW decreased at year {2035 + i}"

    def test_monthly_row_format(self):
        """Each monthly row has 27 fields."""
        for row in self.monthly:
            assert len(row) == 27, f"Row has {len(row)} fields, expected 27"

    def test_yearly_has_required_fields(self):
        required = ["yr", "nw", "inv", "home", "mort", "k401", "tsp", "roth"]
        for yr_data in self.yearly:
            for field in required:
                assert field in yr_data, f"Missing field '{field}' in yearly data"


class TestRentalProperty:
    """Enabling rental property should add significant NW."""

    def test_rental_adds_over_500k(self):
        base_result = run_engine({})
        rental_result = run_engine({
            "rental_enabled": True,
            "rental_purchase_year": 2035,
            "rental_purchase_month": 6,
            "rental_price": 250000,
            "rental_down_pct": 0.20,
            "rental_mort_rate": 0.065,
            "rental_mort_years": 30,
            "rental_monthly_rent": 1800,
        })
        base_nw = base_result["yearly"][-1]["nw"]
        rental_nw = rental_result["yearly"][-1]["nw"]
        delta = rental_nw - base_nw
        assert delta > 500000, f"Rental only added ${delta:,.0f}, expected >$500K"


class TestEarlyRetirement:
    """Early retirement at 55 with Roth conversion should drain 401k."""

    def test_early_retire_drains_401k(self):
        result = run_engine({
            "retire_age": 55,
            "roth_conversion_strategy": "fill_bracket",
            "roth_target_bracket": 0.22,
        })
        yearly = result["yearly"]
        # By 2069, 401k should be significantly drawn down vs baseline
        base = run_engine({})
        base_k401 = base["yearly"][-1].get("k401", 0)
        early_k401 = yearly[-1].get("k401", 0)
        assert early_k401 < base_k401, \
            f"Early retire 401k ({early_k401:,.0f}) should be less than baseline ({base_k401:,.0f})"


class TestToggleFlags:
    """Disabling flags changes behavior."""

    def test_wedding_disabled_means_single_filing(self):
        """When weddingEnabled=false, should file as single (higher taxes, lower spend)."""
        married_result = run_engine({})  # default has wedding
        single_result = run_engine({"wedding_year": 9999, "wedding_month": 1})
        # Single filer should have different NW
        married_nw = married_result["yearly"][-1]["nw"]
        single_nw = single_result["yearly"][-1]["nw"]
        assert married_nw != single_nw, "Wedding toggle should affect NW"

    def test_zero_kids_reduces_spending(self):
        """No kids should mean higher NW (no childcare costs)."""
        kids_result = run_engine({})
        no_kids_result = run_engine({"num_kids": 0})
        kids_nw = kids_result["yearly"][-1]["nw"]
        no_kids_nw = no_kids_result["yearly"][-1]["nw"]
        assert no_kids_nw > kids_nw, f"No kids NW ({no_kids_nw:,.0f}) should exceed kids NW ({kids_nw:,.0f})"

    def test_mortgage_rate_affects_nw(self):
        """Different mortgage rates produce different terminal NW."""
        low_rate = run_engine({"mort_rate": 0.04})
        high_rate = run_engine({"mort_rate": 0.08})
        baseline = run_engine({})
        # All three should differ (rate changes cash flow timing)
        nw_low = low_rate["yearly"][-1]["nw"]
        nw_high = high_rate["yearly"][-1]["nw"]
        nw_base = baseline["yearly"][-1]["nw"]
        assert nw_low != nw_high, "Different rates should produce different NW"
        assert nw_low != nw_base or nw_high != nw_base
