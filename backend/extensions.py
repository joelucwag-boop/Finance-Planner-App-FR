"""
Engine Extensions — Phase 3
Adds rental property, RMD, Roth conversion, and dynamic car support.
Each function is a self-contained helper called from the main engine loop.
"""
import math


# ═══════════════════════════════════════════════════════════════
# RENTAL PROPERTY — Second home with rental income
# ═══════════════════════════════════════════════════════════════

def compute_rental_monthly(
    yr: int, mo: int,
    purchase_year: int, purchase_month: int,
    price: float, down_pct: float,
    mort_rate: float, mort_years: int,
    monthly_rent: float, rent_increase: float,
    vacancy_rate: float,       # fraction of months vacant (e.g., 0.08 = 8%)
    mgmt_fee_pct: float,      # property management fee as % of rent
    prop_tax_rate: float,      # annual property tax as % of price
    insurance_annual: float,
    maintenance_rate: float,   # annual maintenance as % of value
    appreciation: float,       # annual home value growth
    inflation: float,
    start_year: int,
) -> dict:
    """
    Compute monthly rental property financials.

    Returns dict with:
        rent_income: gross rent this month (0 if not yet purchased)
        net_income: rent minus expenses (can be negative = cash drain)
        mortgage_pmt: monthly P&I
        expenses: total monthly operating cost
        value: current property value
        equity: value minus remaining mortgage
        mort_bal: remaining mortgage balance
        is_owned: True if property has been purchased
    """
    # Not yet purchased
    if yr < purchase_year or (yr == purchase_year and mo < purchase_month):
        return {
            "rent_income": 0, "net_income": 0, "mortgage_pmt": 0,
            "expenses": 0, "value": 0, "equity": 0, "mort_bal": 0,
            "is_owned": False,
        }

    months_since = (yr - purchase_year) * 12 + (mo - purchase_month)
    years_since = months_since / 12

    # Property value with appreciation
    value = price * (1 + appreciation) ** years_since

    # Mortgage
    principal = price * (1 - down_pct)
    monthly_rate = mort_rate / 12
    mort_payments = mort_years * 12

    if principal > 0 and monthly_rate > 0 and months_since < mort_payments:
        mortgage_pmt = principal * monthly_rate * (1 + monthly_rate) ** mort_payments / \
                       ((1 + monthly_rate) ** mort_payments - 1)
        # Remaining balance
        mort_bal = principal * ((1 + monthly_rate) ** mort_payments -
                               (1 + monthly_rate) ** months_since) / \
                  ((1 + monthly_rate) ** mort_payments - 1)
    elif months_since >= mort_payments:
        mortgage_pmt = 0
        mort_bal = 0
    else:
        mortgage_pmt = 0
        mort_bal = 0

    equity = value - mort_bal

    # Rental income (grows with rent_increase, reduced by vacancy)
    gross_rent = monthly_rent * (1 + rent_increase) ** years_since
    effective_rent = gross_rent * (1 - vacancy_rate)

    # Operating expenses
    prop_tax_monthly = (price * prop_tax_rate) * (1 + inflation) ** years_since / 12
    ins_monthly = insurance_annual * (1 + inflation) ** years_since / 12
    maint_monthly = (value * maintenance_rate) / 12
    mgmt_fee = effective_rent * mgmt_fee_pct

    total_expenses = mortgage_pmt + prop_tax_monthly + ins_monthly + maint_monthly + mgmt_fee
    net_income = effective_rent - total_expenses

    return {
        "rent_income": round(effective_rent),
        "net_income": round(net_income),
        "mortgage_pmt": round(mortgage_pmt),
        "expenses": round(total_expenses),
        "value": round(value),
        "equity": round(max(0, equity)),
        "mort_bal": round(max(0, mort_bal)),
        "is_owned": True,
    }


# ═══════════════════════════════════════════════════════════════
# RMD — Required Minimum Distributions (SECURE Act 2.0)
# ═══════════════════════════════════════════════════════════════

# IRS Uniform Lifetime Table (SECURE Act 2.0 — effective 2024+)
# Maps age to distribution period (divisor)
RMD_TABLE = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
    78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
    84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
    96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
}

# RMD start age under SECURE Act 2.0:
# Born 1951-1959: age 73
# Born 1960+: age 75
def rmd_start_age(birth_year: int) -> int:
    if birth_year <= 1950:
        return 72
    elif birth_year <= 1959:
        return 73
    else:
        return 75


def compute_rmd(
    age: int,
    birth_year: int,
    k401_bal: float,
    tsp_bal: float,
    # Traditional IRA would go here if added
) -> dict:
    """
    Compute annual Required Minimum Distribution.

    RMDs apply to tax-deferred accounts (401k, TSP, Traditional IRA).
    Roth IRAs do NOT have RMDs for the original owner (SECURE Act 2.0).

    Returns:
        rmd_annual: total required distribution for the year
        rmd_monthly: rmd_annual / 12 (for monthly engine)
        rmd_applies: whether RMDs are required this year
        divisor: the IRS life expectancy divisor used
    """
    start_age = rmd_start_age(birth_year)

    if age < start_age:
        return {"rmd_annual": 0, "rmd_monthly": 0, "rmd_applies": False, "divisor": 0}

    # Get divisor from table (extrapolate for ages > 100)
    divisor = RMD_TABLE.get(age, max(3.0, 6.4 - (age - 100) * 0.3))

    # RMD = total tax-deferred balance / divisor
    total_deferred = k401_bal + tsp_bal
    rmd_annual = total_deferred / divisor if divisor > 0 else 0

    return {
        "rmd_annual": round(rmd_annual),
        "rmd_monthly": round(rmd_annual / 12),
        "rmd_applies": True,
        "divisor": divisor,
    }


# ═══════════════════════════════════════════════════════════════
# ROTH CONVERSION LADDER
# ═══════════════════════════════════════════════════════════════

def compute_roth_conversion(
    age: int,
    retire_age: int,
    k401_bal: float,
    tsp_bal: float,
    annual_taxable_income: float,
    inflation_factor: float,
    is_married: bool,
    conversion_strategy: str = "fill_bracket",  # "fill_bracket", "fixed", "none"
    fixed_annual_amount: float = 50000,
    target_bracket_pct: float = 0.22,  # fill up to the 22% bracket
    birth_year: int = 2003,
) -> dict:
    """
    Compute annual Roth conversion amount.

    The "Roth conversion ladder" converts tax-deferred money (401k/TSP)
    to Roth during low-income years (early retirement before SS/RMDs kick in).
    You pay income tax now at a lower bracket to avoid higher taxes later.

    Strategies:
        "fill_bracket": Convert enough to fill up to target_bracket_pct
        "fixed": Convert a fixed dollar amount each year
        "none": No conversions (default for non-retired)

    Returns:
        conversion_amount: annual amount to convert from 401k/TSP → Roth
        tax_on_conversion: estimated income tax owed on the conversion
        from_k401: amount taken from 401k
        from_tsp: amount taken from TSP
    """
    # Only convert during retirement, before RMD age
    rmd_age = rmd_start_age(birth_year)

    if age < retire_age or age >= rmd_age:
        return {"conversion_amount": 0, "tax_on_conversion": 0, "from_k401": 0, "from_tsp": 0}

    if conversion_strategy == "none":
        return {"conversion_amount": 0, "tax_on_conversion": 0, "from_k401": 0, "from_tsp": 0}

    total_deferred = k401_bal + tsp_bal
    if total_deferred <= 0:
        return {"conversion_amount": 0, "tax_on_conversion": 0, "from_k401": 0, "from_tsp": 0}

    if conversion_strategy == "fixed":
        conversion = min(fixed_annual_amount, total_deferred)
    else:
        # "fill_bracket" — find how much room is left in the target bracket
        # 2026 MFJ brackets (inflation-adjusted):
        bracket_tops = {
            0.10: 23200, 0.12: 94300, 0.22: 201050, 0.24: 383900,
        }
        std_deduction = (29200 if is_married else 14600) * inflation_factor
        bracket_limit = bracket_tops.get(target_bracket_pct, 201050) * inflation_factor

        # Room = bracket top - (current income - standard deduction)
        taxable_after_ded = max(0, annual_taxable_income - std_deduction)
        room = max(0, bracket_limit - taxable_after_ded)
        conversion = min(room, total_deferred)

    # Estimate tax on conversion (at the marginal rate)
    # Simplified: use the target bracket rate
    marginal_rate = target_bracket_pct if conversion_strategy == "fill_bracket" else 0.22
    tax = conversion * marginal_rate

    # Split proportionally between 401k and TSP
    k401_share = k401_bal / max(total_deferred, 1)
    from_k401 = conversion * k401_share
    from_tsp = conversion - from_k401

    return {
        "conversion_amount": round(conversion),
        "tax_on_conversion": round(tax),
        "from_k401": round(from_k401),
        "from_tsp": round(from_tsp),
    }


# ═══════════════════════════════════════════════════════════════
# DYNAMIC CAR ARRAY
# ═══════════════════════════════════════════════════════════════

def parse_car_inputs(inputs: dict) -> tuple:
    """
    Parse car inputs from the flexible format.
    Supports both the old fixed format (car1_year, car1_price, ..., car5_year, car5_price)
    and a new dynamic format (cars: [{year, price, apr, term}]).

    Returns (car_years, car_prices, car_aprs, car_terms).
    """
    # Check for new dynamic format first
    cars = inputs.get("cars")
    if cars and isinstance(cars, list):
        years = [c.get("year", 0) for c in cars]
        prices = [c.get("price", 30000) for c in cars]
        aprs = [c.get("apr", 0.06) for c in cars]
        terms = [c.get("term", 60) for c in cars]
        return years, prices, aprs, terms

    # Fall back to fixed 5-slot format (backward compatible)
    years = [
        inputs.get("car1_year", 3), inputs.get("car2_year", 10),
        inputs.get("car3_year", 17), inputs.get("car4_year", 24),
        inputs.get("car5_year", 31),
    ]
    prices = [
        inputs.get("car1_price", 35000), inputs.get("car2_price", 40000),
        inputs.get("car3_price", 45000), inputs.get("car4_price", 50000),
        inputs.get("car5_price", 55000),
    ]
    # Use same APR/term for all (old format)
    apr = inputs.get("car_apr", 0.07)
    term = inputs.get("car_term", 60)
    aprs = [apr] * len(years)
    terms = [term] * len(years)

    return years, prices, aprs, terms


def compute_car_loan_dynamic(
    years_worked: int,
    month: int,
    car_years: list,
    car_prices: list,
    car_aprs: list,
    car_terms: list,
    purchase_month: int = 6,
) -> tuple:
    """
    Dynamic car loan computation supporting variable APR/term per car.

    Returns (loan_balance, monthly_payment, active_car_idx).
    """
    active_car_idx = -1
    for i, cy in enumerate(car_years):
        if years_worked >= cy:
            active_car_idx = i

    if active_car_idx < 0:
        return 0.0, 0.0, -1

    price = car_prices[active_car_idx]
    apr = car_aprs[active_car_idx]
    term = car_terms[active_car_idx]
    financed = price * 0.9  # 10% down

    months_since = (years_worked - car_years[active_car_idx]) * 12 + (month - purchase_month)

    if months_since < 0 or months_since >= term:
        return 0.0, 0.0, active_car_idx

    monthly_rate = apr / 12
    if monthly_rate > 0:
        pmt_val = financed * monthly_rate * (1 + monthly_rate) ** term / \
                  ((1 + monthly_rate) ** term - 1)
        bal = financed * ((1 + monthly_rate) ** term -
                          (1 + monthly_rate) ** months_since) / \
              ((1 + monthly_rate) ** term - 1)
    else:
        pmt_val = financed / term
        bal = financed - pmt_val * months_since

    return max(0, bal), pmt_val, active_car_idx


# ═══════════════════════════════════════════════════════════════
# SMART WITHDRAWAL ORDERING (replaces simple cascade)
# ═══════════════════════════════════════════════════════════════

def compute_retirement_withdrawal(
    age: int,
    birth_year: int,
    retire_age: int,
    is_married: bool,
    monthly_need: float,
    inflation_factor: float,
    # Account balances
    brok: float,
    acorn: float,
    prim: float,
    k401: float,
    tsp: float,
    roth: float,
    # Strategy
    roth_conversion_strategy: str = "fill_bracket",
    roth_conversion_amount: float = 50000,
    roth_target_bracket: float = 0.22,
) -> dict:
    """
    Smart withdrawal ordering for retirement:
    1. Take RMD first (required, from 401k/TSP)
    2. Roth conversion (if in the conversion window)
    3. Draw from taxable accounts (brokerage, acorns, primerica)
    4. Draw from tax-deferred (401k, TSP) — beyond RMD if needed
    5. Draw from Roth last (tax-free, let it grow)

    Returns dict with per-account withdrawal amounts and metadata.
    """
    if age < retire_age:
        return {
            "total": 0, "from_brok": 0, "from_acorn": 0, "from_prim": 0,
            "from_k401": 0, "from_tsp": 0, "from_roth": 0,
            "rmd_amount": 0, "roth_conversion": 0, "roth_conv_tax": 0,
        }

    need = monthly_need

    # Step 1: RMD (annual, divided by 12)
    rmd = compute_rmd(age, birth_year, k401, tsp)
    rmd_monthly = rmd["rmd_monthly"]

    # Step 2: Roth conversion (annual, divided by 12)
    annual_income_est = monthly_need * 12  # rough
    roth_conv = compute_roth_conversion(
        age, retire_age, k401, tsp, annual_income_est,
        inflation_factor, is_married,
        roth_conversion_strategy, roth_conversion_amount, roth_target_bracket,
    )
    roth_conv_monthly = roth_conv["conversion_amount"] / 12

    # Step 3: Draw from taxable first (brokerage → acorns → primerica)
    from_brok = min(need, brok)
    need -= from_brok

    from_acorn = min(need, acorn)
    need -= from_acorn

    from_prim = min(need, prim)
    need -= from_prim

    # Step 4: Tax-deferred (401k → TSP) — RMD counts toward this
    from_k401 = max(rmd_monthly * (k401 / max(k401 + tsp, 1)), min(need, k401))
    need -= from_k401

    from_tsp = max(rmd_monthly * (tsp / max(k401 + tsp, 1)), min(need, tsp))
    need -= from_tsp

    # Step 5: Roth last resort
    from_roth = min(need, roth)
    need -= from_roth

    total = from_brok + from_acorn + from_prim + from_k401 + from_tsp + from_roth

    return {
        "total": round(total),
        "from_brok": round(from_brok),
        "from_acorn": round(from_acorn),
        "from_prim": round(from_prim),
        "from_k401": round(from_k401),
        "from_tsp": round(from_tsp),
        "from_roth": round(from_roth),
        "rmd_amount": round(rmd_monthly),
        "roth_conversion": round(roth_conv_monthly),
        "roth_conv_tax": round(roth_conv["tax_on_conversion"] / 12),
    }
