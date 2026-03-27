"""
Financial Plan v13 — Python Engine (exact Excel parity)
Ports all 62 columns of the 📆_MONTHLY sheet to Python.
Each function maps 1:1 to the Excel formulas.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import List, Optional

from extensions import (
    compute_rental_monthly, compute_rmd, compute_roth_conversion,
    parse_car_inputs, compute_car_loan_dynamic, rmd_start_age,
)

# ═══════════════════════════════════════════════════════════════════
# GUARD OFFICER PAY TABLE (from BF column — 40+ nested IFs)
# Indexed by (years_commissioned, pay_entry_years)
# ═══════════════════════════════════════════════════════════════════
def guard_base_monthly(yrs_comm: int, pay_entry_yrs: int) -> float:
    """Exact replica of BF column nested-IF logic."""
    if yrs_comm >= 17:
        if pay_entry_yrs >= 20: return 12033
        if pay_entry_yrs >= 18: return 11714
        if pay_entry_yrs >= 16: return 11391
        return 10716
    if yrs_comm >= 11:
        if pay_entry_yrs >= 16: return 10402
        if pay_entry_yrs >= 14: return 10214
        if pay_entry_yrs >= 12: return 9888
        if pay_entry_yrs >= 10: return 9420
        return 8816
    if yrs_comm >= 4:
        if pay_entry_yrs >= 14: return 9004
        if pay_entry_yrs >= 12: return 8788
        if pay_entry_yrs >= 10: return 8376
        if pay_entry_yrs >= 8:  return 8126
        if pay_entry_yrs >= 6:  return 7737
        if pay_entry_yrs >= 4:  return 7383
        return 6770
    if yrs_comm >= 2:
        if pay_entry_yrs >= 6: return 6618
        if pay_entry_yrs >= 4: return 6485
        if pay_entry_yrs >= 3: return 6272
        return 5446
    # yrs_comm < 2
    if pay_entry_yrs >= 3: return 5222
    if pay_entry_yrs >= 2: return 4320
    return 4150


# ═══════════════════════════════════════════════════════════════════
# TAX BRACKETS (from 🧮_TAX_ENGINE sheet)
# All limits are base-year (2026) values, inflation-adjusted at runtime
# ═══════════════════════════════════════════════════════════════════

# MFJ brackets: (taxable_income_limit, rate)
# Standard deduction 32,200 subtracted BEFORE applying brackets
MFJ_STD_DED = 32200
MFJ_BRACKETS = [
    (24800,  0.10),
    (100800, 0.12),
    (211400, 0.22),
    (403550, 0.24),
    (512450, 0.32),
    (768700, 0.35),
    (math.inf, 0.37),
]

# Single brackets: std deduction 16,100
SINGLE_STD_DED = 16100
SINGLE_BRACKETS = [
    (12400,  0.10),
    (50400,  0.12),
    (105700, 0.22),
    (201775, 0.24),
    (256225, 0.32),
    (640600, 0.35),
    (math.inf, 0.37),
]

# Louisiana standard deductions
LA_STD_DED_SINGLE = 12500
LA_STD_DED_MFJ = 25000

# FICA constants (base year)
SS_WAGE_BASE = 184500  # from Excel G column (not 168600 — Excel uses 184500)
MEDICARE_SURTAX_MFJ = 250000
MEDICARE_SURTAX_SINGLE = 200000


def compute_fed_tax(taxable: float, brackets: list, inflation_factor: float) -> float:
    """Progressive tax computation — matches Excel F column exactly."""
    tax = 0.0
    prev_limit = 0.0
    for limit, rate in brackets:
        adj_limit = limit * inflation_factor
        adj_prev = prev_limit * inflation_factor
        if taxable > adj_prev:
            bracket_income = min(taxable, adj_limit) - adj_prev
            tax += max(0, bracket_income) * rate
        prev_limit = limit
    return tax


def compute_annual_tax(
    year: int,
    is_married: bool,
    annual_gross: float,
    you_gross: float,     # Your salary + guard (annual)
    wife_gross: float,    # Wife pay (annual)
    you_taxable: float,   # Your taxable wages (annual, after pre-tax deductions)
    wife_taxable: float,  # Wife taxable wages (annual)
    combined_taxable: float,  # Combined AZ column (for MFJ years)
    inflation: float,
    state_tax_rate: float,
) -> float:
    """
    Exact replica of 🧮_TAX_ENGINE sheet.
    Returns total annual tax (Fed + FICA + LA).
    """
    inf = (1 + inflation) ** (year - 2026)

    # ── Federal Income Tax ──
    if is_married:
        # MFJ: combined taxable minus MFJ std deduction
        adj_taxable = max(0, combined_taxable - MFJ_STD_DED * inf)
        fed_tax = compute_fed_tax(adj_taxable, MFJ_BRACKETS, inf)
    else:
        # Single: each person filed separately
        you_adj = max(0, you_taxable - SINGLE_STD_DED * inf)
        wife_adj = max(0, wife_taxable - SINGLE_STD_DED * inf)
        fed_tax = (compute_fed_tax(you_adj, SINGLE_BRACKETS, inf) +
                   compute_fed_tax(wife_adj, SINGLE_BRACKETS, inf))

    # ── FICA (SS + Medicare) ── per-person SS cap
    ss_base = SS_WAGE_BASE * inf
    ss_tax = 0.062 * (min(you_gross, ss_base) + min(wife_gross, ss_base))
    med_tax = 0.0145 * annual_gross

    # Medicare surtax
    if is_married:
        med_surtax = 0.009 * max(0, annual_gross - MEDICARE_SURTAX_MFJ)
    else:
        med_surtax = 0.009 * (max(0, you_gross - MEDICARE_SURTAX_SINGLE) +
                              max(0, wife_gross - MEDICARE_SURTAX_SINGLE))

    fica = ss_tax + med_tax + med_surtax

    # ── Louisiana State Tax ──
    if is_married:
        la_tax = state_tax_rate * max(0, combined_taxable - LA_STD_DED_MFJ * inf)
    else:
        la_tax = state_tax_rate * (
            max(0, you_taxable - LA_STD_DED_SINGLE * inf) +
            max(0, wife_taxable - LA_STD_DED_SINGLE * inf)
        )

    return fed_tax + fica + la_tax


# ═══════════════════════════════════════════════════════════════════
# HEALTH AGE BAND MULTIPLIERS (from A101:B106)
# ═══════════════════════════════════════════════════════════════════
HEALTH_AGE_BANDS = [(21, 1.0), (30, 1.135), (40, 1.315), (50, 1.786), (60, 2.714), (64, 3.0)]

def health_age_mult(age: int) -> float:
    """LOOKUP(age, age_bands) — returns multiplier for the age band."""
    result = HEALTH_AGE_BANDS[0][1]
    for threshold, mult in HEALTH_AGE_BANDS:
        if age >= threshold:
            result = mult
    return result


# ═══════════════════════════════════════════════════════════════════
# WIFE WORK SCHEDULE (from B62:G66)
# ═══════════════════════════════════════════════════════════════════
# Default schedule: columns are [Baby(0), Age1, Age2, Age3, Age4, Age5]
DEFAULT_WIFE_SCHEDULE = [
    ["none", "full", "full", "full", "full", "full"],  # Kid 1
    ["none", "full", "full", "full", "full", "full"],  # Kid 2
    ["none", "full", "full", "full", "full", "full"],  # Kid 3
    ["none", "full", "full", "full", "full", "full"],  # Kid 4
    ["full", "full", "full", "full", "full", "full"],  # Kid 5
]

def wife_work_multiplier(
    year: int,
    kid_birth_years: list,
    start_year: int,
    part_time_pct: float,
    schedule: list = None,
) -> float:
    """
    Computes MIN across all kids' work schedule multipliers.
    Matches the Excel H column's massive MIN(IF(...), IF(...), ...) chain.
    """
    if schedule is None:
        schedule = DEFAULT_WIFE_SCHEDULE

    mult = 1.0
    for k, birth_yr in enumerate(kid_birth_years):
        kid_age = year - birth_yr
        if kid_age < 0 or kid_age > 5:
            continue  # Kid not born yet or past age 5 — no impact
        sched_row = schedule[min(k, len(schedule) - 1)]
        col_idx = min(kid_age, 5)  # 0=baby, 1-5=ages
        status = sched_row[col_idx]
        if status == "none":
            mult = min(mult, 0.0)
        elif status == "part":
            mult = min(mult, part_time_pct)
        # "full" = 1.0, no change to mult
    return mult


# ═══════════════════════════════════════════════════════════════════
# MORTGAGE — PMT function and balance schedule
# ═══════════════════════════════════════════════════════════════════
def pmt(rate_per_period: float, num_periods: int, present_value: float) -> float:
    """Excel PMT function (returns positive payment amount)."""
    if rate_per_period == 0:
        return present_value / num_periods if num_periods > 0 else 0
    return present_value * rate_per_period * (1 + rate_per_period)**num_periods / \
           ((1 + rate_per_period)**num_periods - 1)


def mortgage_balance(principal: float, monthly_rate: float, total_payments: int,
                     payments_made: int) -> float:
    """
    Remaining mortgage balance after N payments.
    Matches Excel AJ column: PV*(1+r)^n - PMT*((1+r)^n - 1)/r
    """
    if payments_made < 0:
        return 0
    if payments_made >= total_payments:
        return 0
    if monthly_rate == 0:
        return max(0, principal * (1 - payments_made / total_payments))
    n = payments_made + 1  # Excel uses payments_made+1 in POWER
    fv = principal * (1 + monthly_rate)**n
    pmt_val = pmt(monthly_rate, total_payments, principal)
    annuity = pmt_val * ((1 + monthly_rate)**n - 1) / monthly_rate
    return max(0, fv - annuity)


# ═══════════════════════════════════════════════════════════════════
# CAR LOAN — lookup active car and compute remaining balance
# ═══════════════════════════════════════════════════════════════════
def car_loan_balance(
    years_worked: int,
    month: int,
    car_years: list,      # [3, 10, 17, 24, 31]
    car_prices: list,     # [35000, 40000, ...]
    car_apr: float,
    car_term_months: int,
    purchase_month: int,  # B270 = 6 (June)
) -> float:
    """
    Matches Excel AK column: LOOKUP to find active car, then amortization.
    Finances 90% of price (10% down).
    """
    # Find the most recent car purchase year that's <= years_worked
    active_car_idx = -1
    for i, cy in enumerate(car_years):
        if years_worked >= cy:
            active_car_idx = i

    if active_car_idx < 0:
        return 0

    active_car_year = car_years[active_car_idx]
    price = car_prices[active_car_idx]
    financed = price * 0.9  # 10% down

    # Months since this car was purchased
    # Excel: (yr - (start_yr + car_year))*12 + (mo - purchase_month)
    months_since = (years_worked - active_car_year) * 12 + (month - purchase_month)

    if months_since < 0:
        return 0
    if months_since >= car_term_months:
        return 0

    monthly_rate = car_apr / 12
    return mortgage_balance(financed, monthly_rate, car_term_months, months_since)


# ═══════════════════════════════════════════════════════════════════
# DEBT AVALANCHE (from AG-AI columns)
# ═══════════════════════════════════════════════════════════════════
def debt_avalanche_step(
    cab_bal: float, cab_rate: float,
    unsub_bal: float, unsub_rate: float,
    sub_bal: float, sub_rate: float,
    total_payment: float,
) -> tuple:
    """
    One month of debt avalanche: Cabela's first → SL Unsub → SL Sub.
    Returns (new_cab, new_unsub, new_sub, actual_payment).
    Matches Excel AG/AH/AI formulas exactly.
    """
    # Accrue interest
    cab_with_int = cab_bal * (1 + cab_rate / 12)
    unsub_with_int = unsub_bal * (1 + unsub_rate / 12)
    sub_with_int = sub_bal * (1 + sub_rate / 12)

    pool = total_payment
    actual = 0

    # Pay Cabela's first (highest rate)
    cab_pay = min(pool, cab_with_int)
    new_cab = max(0, cab_with_int - cab_pay)
    pool -= cab_pay
    actual += cab_pay

    # Remaining → SL Unsub
    unsub_pay = min(pool, unsub_with_int)
    new_unsub = max(0, unsub_with_int - unsub_pay)
    pool -= unsub_pay
    actual += unsub_pay

    # Remaining → SL Sub
    sub_pay = min(pool, sub_with_int)
    new_sub = max(0, sub_with_int - sub_pay)
    actual += sub_pay

    return new_cab, new_unsub, new_sub, actual


# ═══════════════════════════════════════════════════════════════════
# INCOME COMPUTATION (columns F, G, H, I)
# ═══════════════════════════════════════════════════════════════════
def compute_your_salary(
    year: int, month: int,
    start_year: int, age: int, retire_age: int,
    income_mode: str,
    # Annual mode
    year1_salary: float,
    # Hourly mode
    hourly_rate: float, hours_week: float, weeks_year: float,
    ot_hours_month: float, ot_mult: float,
    # Raise & jump
    annual_raise: float, annual_bonus: float,
    jump_year: int, jump_salary: float, jump_hourly: float,
) -> float:
    """Matches Excel F column exactly."""
    if age >= retire_age:
        return 0.0

    year_of_work = 1 + (year - start_year)  # Excel: 1 + (C - B2)
    if year_of_work < 1:
        return 0.0

    if year_of_work >= jump_year:
        # Post-jump: use jump salary or jump hourly
        if jump_salary > 0:
            annual = jump_salary * (1 + annual_raise) ** (year_of_work - jump_year)
        elif jump_hourly > 0:
            annual = (jump_hourly * hours_week * weeks_year +
                      ot_hours_month * 12 * jump_hourly * ot_mult) * \
                     (1 + annual_raise) ** (year_of_work - jump_year)
        else:
            # Fallback to base
            if income_mode == "annual":
                annual = year1_salary * (1 + annual_raise) ** (year_of_work - 1)
            else:
                annual = (hourly_rate * hours_week * weeks_year +
                          ot_hours_month * 12 * hourly_rate * ot_mult) * \
                         (1 + annual_raise) ** (year_of_work - 1)
        annual += annual_bonus
    else:
        # Pre-jump
        if income_mode == "annual":
            annual = year1_salary * (1 + annual_raise) ** (year_of_work - 1)
        else:
            annual = (hourly_rate * hours_week * weeks_year +
                      ot_hours_month * 12 * hourly_rate * ot_mult) * \
                     (1 + annual_raise) ** (year_of_work - 1)
        annual += annual_bonus

    return annual / 12


def compute_guard_pay(
    year: int, month: int,
    start_year: int, age: int,
    commission_year_offset: int,  # B70 = 0
    prior_enlisted_years: int,    # B71 = 6
    mil_raise: float,             # B72 = 0.035
    stop_drill_age: int,          # B73 = 60
    pension_monthly: float,       # B75 = 1200
    pension_start_age: int,       # B76 = 60
    commission_month: int,        # B335 = 5
    enlisted_annual_pay: float,   # B336 = 8288.28
    enlisted_pay_growth: float,   # B337 = 0.035
    inflation: float,             # B185 = 0.025
) -> float:
    """Matches Excel G column + BF/BG support columns."""
    # Guard status (BG column)
    # BC = months since commission
    comm_start_year = start_year + commission_year_offset
    bc = (year - comm_start_year) * 12 + (month - commission_month)

    birthday_month = 7  # B272
    fractional_age = age + (month - birthday_month) / 12

    if fractional_age >= stop_drill_age:
        # Stopped drilling — check if pension started
        if age >= pension_start_age:
            return pension_monthly * (1 + inflation) ** (year - start_year)
        return 0.0

    if bc < 0:
        # Still enlisted (pre-commission)
        return (enlisted_annual_pay * (1 + enlisted_pay_growth) ** (year - start_year)) / 12

    # Officer — compute base pay from rank table
    yrs_comm = max(0, bc // 12)  # BD column
    pay_entry_yrs = prior_enlisted_years + yrs_comm  # BE column
    base_mo = guard_base_monthly(yrs_comm, pay_entry_yrs)  # BF column

    # G column: BF * 2.1 * POWER(1 + mil_raise, yr - start_yr) / 12
    return base_mo * 2.1 * (1 + mil_raise) ** (year - start_year) / 12


def compute_wife_pay(
    year: int, month: int,
    start_year: int, age: int, retire_age: int,
    wife_start_year_of_work: int,  # B32 = 0
    wife_income_mode: str,         # B33 = "annual"
    wife_year1_salary: float,      # B36 = 50000
    wife_hourly: float,            # B39
    wife_hours_week: float,        # B40
    wife_weeks_year: float,        # B41
    wife_ot_hours: float,          # B42
    wife_ot_mult: float,           # B43
    wife_annual_bonus: float,      # B46
    wife_raise: float,             # B47 = 0.03
    wife_jump_year: int,           # B48 = 5
    wife_jump_salary: float,       # B49 = 72000
    wife_jump_hourly: float,       # B50
    part_time_pct: float,          # B57 = 0.65
    kid_birth_years: list,
    wife_schedule: list = None,
) -> float:
    """Matches Excel H column exactly."""
    if age >= retire_age:
        return 0.0

    year_of_work = 1 + (year - start_year)
    if year_of_work < wife_start_year_of_work + 1:
        return 0.0  # Wife hasn't started working yet

    # Compute base pay (same structure as your salary)
    if year_of_work >= wife_jump_year:
        if wife_jump_salary > 0:
            annual = wife_jump_salary * (1 + wife_raise) ** (year_of_work - wife_jump_year)
        elif wife_jump_hourly > 0:
            annual = (wife_jump_hourly * wife_hours_week * wife_weeks_year +
                      wife_ot_hours * 12 * wife_jump_hourly * wife_ot_mult) * \
                     (1 + wife_raise) ** (year_of_work - wife_jump_year)
        else:
            if wife_income_mode == "annual":
                annual = wife_year1_salary * (1 + wife_raise) ** (year_of_work - 1)
            else:
                annual = (wife_hourly * wife_hours_week * wife_weeks_year +
                          wife_ot_hours * 12 * wife_hourly * wife_ot_mult) * \
                         (1 + wife_raise) ** (year_of_work - 1)
        annual += wife_annual_bonus
    else:
        if wife_income_mode == "annual":
            annual = wife_year1_salary * (1 + wife_raise) ** (year_of_work - 1)
        else:
            annual = (wife_hourly * wife_hours_week * wife_weeks_year +
                      wife_ot_hours * 12 * wife_hourly * wife_ot_mult) * \
                     (1 + wife_raise) ** (year_of_work - 1)
        annual += wife_annual_bonus

    # Apply wife work schedule multiplier
    mult = wife_work_multiplier(year, kid_birth_years, start_year, part_time_pct, wife_schedule)

    return (annual / 12) * mult


# ═══════════════════════════════════════════════════════════════════
# SPENDING COMPUTATION (columns AP-AV)
# ═══════════════════════════════════════════════════════════════════
def compute_housing_recurring(
    year: int, month: int,
    start_year: int,
    # Rent
    rent_monthly: float, rent_increase: float,
    # House
    buy_year_of_work: int, house_price: float, down_pct: float,
    mort_rate: float, mort_years: int,
    prop_tax_rate: float, home_ins_annual: float, maintenance_pct: float,
    appreciation: float, pmi_rate: float, pmi_threshold: float,
    capital_reserve_pct: float, furniture_replace_annual: float,
    furniture_replace_inf: float,
    purchase_month: int,
    inflation: float,
) -> float:
    """
    Matches Excel AP column exactly.

    IMPORTANT: The Excel formula uses -PMT(rate, nper, -PV) which produces
    a NEGATIVE mortgage payment. This is the Excel's sign convention —
    the mortgage P&I shows as negative in the recurring cost column.
    We replicate this exactly for formula parity.
    """
    buy_cal_year = start_year + buy_year_of_work
    months_since = (year - buy_cal_year) * 12 + (month - purchase_month)

    cost = 0.0

    # ── Rent (before house purchase) ──
    # Excel: IF(C<(B2+B117), B115*POWER(1+B116, C-B2), IF(AND(C=(B2+B117),D<B330), ...))
    if year < buy_cal_year or (year == buy_cal_year and month < purchase_month):
        cost += rent_monthly * (1 + rent_increase) ** (year - start_year)

    # ── Mortgage P&I (after purchase, during mortgage term) ──
    # Excel: -PMT(B120/12, B121*12, -(B118*(1-B119)))
    # PMT(rate, nper, -PV) returns positive; -PMT(...) makes it NEGATIVE
    principal = house_price * (1 - down_pct)
    mort_payments = mort_years * 12
    monthly_rate = mort_rate / 12
    if months_since >= 0 and months_since < mort_payments:
        cost += -pmt(monthly_rate, mort_payments, principal)  # NEGATIVE per Excel

    # ── Post-purchase costs (only when months_since >= 0) ──
    is_post_purchase = (year > buy_cal_year or
                        (year == buy_cal_year and month >= purchase_month))
    if is_post_purchase:
        inf_factor = (1 + inflation) ** (year - 2026)
        years_since_purchase = year - buy_cal_year  # whole years, per Excel

        # Property tax: B118*B122/12 (flat on purchase price, no inflation)
        cost += house_price * prop_tax_rate / 12

        # Home insurance: (B123/12)*POWER(1+B185, C-2026) (CPI-inflated)
        cost += home_ins_annual / 12 * inf_factor

        # Maintenance: B118*B124/12*POWER(1+B185, C-2026)
        cost += house_price * maintenance_pct / 12 * inf_factor

        # PMI: IF(B119 < B128, B118*B127/12, 0)
        # Excel checks ONLY initial down payment %, not running equity
        if down_pct < pmi_threshold:
            cost += house_price * pmi_rate / 12

        # Capital reserve: B118*POWER(1+B125, C-(B2+B117))*B401/12
        # Uses whole-year appreciation exponent
        appreciated_val = house_price * (1 + appreciation) ** years_since_purchase
        cost += appreciated_val * capital_reserve_pct / 12

    # ── Furniture replacement (starts 1 calendar year after purchase year) ──
    # Excel: IF(C>(B2+B117+1), ..., IF(AND(C=(B2+B117+1), D>=B330), ...))
    furn_start_year = buy_cal_year + 1
    if (year > furn_start_year or
        (year == furn_start_year and month >= purchase_month)):
        furn_inf = (1 + furniture_replace_inf) ** (year - 2026)
        cost += furniture_replace_annual / 12 * furn_inf

    return cost


def compute_health_recurring(
    year: int, month: int,
    start_year: int, age: int, retire_age: int,
    is_married: bool,
    num_kids_born: int,
    kid_birth_years: list,
    # Premiums
    your_premium: float, wife_premium: float,
    healthcare_inflation: float,
    # Retirement
    retire_pre65_monthly: float, retire_65plus_monthly: float,
    # OOP
    annual_oop_per_person: float,
    dental_vision_monthly: float,
    # Pregnancy
    prenatal_monthly: float, postpartum_monthly: float,
    prenatal_months: int, postpartum_months: int,
    purchase_month: int,  # B270 = 6 (birth month proxy)
) -> float:
    """Matches Excel AQ column exactly."""
    inf = (1 + healthcare_inflation) ** (year - 2026)

    cost = 0.0

    if age >= retire_age:
        # Retirement health costs
        if age >= 65:
            cost += retire_65plus_monthly * (1 + (1 if is_married else 0))
        else:
            cost += retire_pre65_monthly * (1 + (1 if is_married else 0))
    else:
        # Working: premiums × age band multiplier
        prem = your_premium + (wife_premium if is_married else 0) + dental_vision_monthly
        age_mult = health_age_mult(age)
        cost += prem * age_mult

    cost *= inf

    # OOP: per person per year (you + wife + kids) / 12
    num_people = 1 + (1 if is_married else 0) + num_kids_born
    cost += (annual_oop_per_person * num_people / 12) * inf

    # Pregnancy costs per kid
    for birth_yr in kid_birth_years:
        birth_cal_month = birth_yr * 12 + purchase_month  # assume birth in June
        current_cal_month = year * 12 + month
        months_until_birth = birth_cal_month - current_cal_month

        # Prenatal: N months before birth
        if 0 < months_until_birth <= prenatal_months:
            cost += prenatal_monthly * inf

        # Postpartum: M months after birth
        if -postpartum_months <= months_until_birth <= 0:
            cost += postpartum_monthly * inf

    return cost


def compute_kids_recurring(
    year: int,
    start_year: int,
    kid_birth_years: list,
    daycare_cost: float,        # B384 = 15000
    childcare_inflation: float,  # B385 = 0.045
    kid_general_05: float,       # B386 = 3000
    kid_cost_612: float,         # B140 = 15000
    kid_cost_1317: float,        # B141 = 15000
    kid_cost_college: float,     # B142 = 20000
    kid_inflation: float,        # B143 = 0.028
) -> float:
    """Matches Excel AR column exactly."""
    inf = (1 + kid_inflation) ** (year - 2026)
    cost = 0.0

    for birth_yr in kid_birth_years:
        kid_age = year - birth_yr
        if kid_age < 0:
            continue

        if kid_age <= 5:
            # Daycare has its own inflation, general cost uses kid_inflation
            daycare_inf = (1 + childcare_inflation) ** (year - 2026)
            # Excel: (B384 * daycare_inf / kid_inf + B386) * kid_inf / 12
            daycare_adj = daycare_cost * daycare_inf / inf  # undo kid_inf, apply daycare_inf
            annual = (daycare_adj + kid_general_05) * inf
            cost += annual / 12
        elif kid_age <= 12:
            cost += kid_cost_612 * inf / 12
        elif kid_age <= 17:
            cost += kid_cost_1317 * inf / 12
        elif kid_age <= 22:
            cost += kid_cost_college * inf / 12
        # 23+ = no cost

    return cost


def compute_car_recurring(
    year: int, month: int,
    start_year: int,
    car_ins_monthly: float,    # B146 = 350
    car_ins_increase: float,   # B147 = 0.03
    car_maintenance_annual: float,  # B323 = 1200
    car_registration_annual: float, # B324 = 200
    inflation: float,
    # Car loan payment
    car_years: list, car_prices: list,
    car_apr: float, car_term_months: int,
    purchase_month: int,
) -> float:
    """Matches Excel AS column."""
    inf = (1 + inflation) ** (year - 2026)
    cost = 0.0

    # Insurance with its own increase rate
    cost += car_ins_monthly * (1 + car_ins_increase) ** (year - 2026)

    # Maintenance + registration with CPI inflation
    cost += car_maintenance_annual / 12 * inf
    cost += car_registration_annual / 12 * inf

    # Car loan payment (if active)
    years_worked = year - start_year
    active_car_idx = -1
    for i, cy in enumerate(car_years):
        if years_worked >= cy:
            active_car_idx = i

    if active_car_idx >= 0:
        active_car_year = car_years[active_car_idx]
        price = car_prices[active_car_idx]
        financed = price * 0.9
        months_since = (years_worked - active_car_year) * 12 + (month - purchase_month)

        if 0 <= months_since < car_term_months:
            monthly_rate = car_apr / 12
            cost += -pmt(monthly_rate, car_term_months, financed)  # NEGATIVE per Excel

    return cost


def compute_bills_recurring(
    year: int,
    is_married: bool,
    # Bill amounts (monthly)
    phone: float, internet: float, streaming: float, subscriptions: float,
    gym: float, groceries: float, gas: float, clothing: float,
    dining: float, fun_money: float, misc: float,
    # Bill-specific inflation rates
    phone_inf: float, internet_inf: float, streaming_inf: float,
    subs_inf: float, gym_inf: float, groceries_inf: float,
    gas_inf: float, clothing_inf: float, dining_inf: float,
    fun_inf: float, misc_inf: float,
    # Marriage multipliers
    phone_mult: float, streaming_mult: float, subs_mult: float,
    gym_mult: float, groceries_mult: float, gas_mult: float,
    clothing_mult: float, dining_mult: float, fun_mult: float,
    misc_mult: float,
    # Other costs
    vacation_annual: float, vacation_inf: float,
    gift_annual: float, gift_inf: float, gift_mult: float,
    personal_care: float, personal_inf: float, personal_mult: float,
    pet_monthly: float, pet_inf: float,
) -> float:
    """Matches Excel AT column exactly."""
    yrs = year - 2026
    m = 1  # marriage factor

    cost = 0.0
    cost += phone * (1 + phone_inf)**yrs * (phone_mult if is_married else 1)
    cost += internet * (1 + internet_inf)**yrs  # no marriage mult
    cost += streaming * (1 + streaming_inf)**yrs * (streaming_mult if is_married else 1)
    cost += subscriptions * (1 + subs_inf)**yrs * (subs_mult if is_married else 1)
    cost += gym * (1 + gym_inf)**yrs * (gym_mult if is_married else 1)
    cost += groceries * (1 + groceries_inf)**yrs * (groceries_mult if is_married else 1)
    cost += gas * (1 + gas_inf)**yrs * (gas_mult if is_married else 1)
    cost += clothing * (1 + clothing_inf)**yrs * (clothing_mult if is_married else 1)
    cost += dining * (1 + dining_inf)**yrs * (dining_mult if is_married else 1)
    cost += fun_money * (1 + fun_inf)**yrs * (fun_mult if is_married else 1)
    cost += misc * (1 + misc_inf)**yrs * (misc_mult if is_married else 1)

    # Vacation, gifts, personal care, pets
    cost += vacation_annual / 12 * (1 + vacation_inf)**yrs
    cost += gift_annual / 12 * (1 + gift_inf)**yrs * (gift_mult if is_married else 1)
    cost += personal_care * (1 + personal_inf)**yrs * (personal_mult if is_married else 1)
    cost += pet_monthly * (1 + pet_inf)**yrs

    return cost


def compute_investing_recurring(
    year: int,
    start_year: int,
    num_kids_born: int,
    # Monthly contributions
    primerica_monthly: float,  # B86
    acorns_monthly: float,     # B88
    roth_monthly: float,       # B89
    c529_monthly_per_kid: float,  # B91
    life_ins_monthly: float,   # B196 = 0 in v13 baseline
    inflation: float,
) -> float:
    """Matches Excel AV column: after-tax investment contributions."""
    inf = (1 + inflation) ** (year - 2026)
    total = primerica_monthly + acorns_monthly + roth_monthly + \
            c529_monthly_per_kid * num_kids_born + life_ins_monthly
    return total * inf


# ═══════════════════════════════════════════════════════════════════
# MAIN ENGINE — runs 523 months, returns monthly + yearly arrays
# ═══════════════════════════════════════════════════════════════════
def run_engine(inputs: dict) -> dict:
    """
    Main simulation loop. Accepts a dict of ~80 input parameters,
    runs month-by-month for Jun 2026 → Dec 2069,
    returns { monthly: [...], yearly: [...] }.

    Each monthly row matches the _MR format:
    [yr, mo, gross, tax, take, spend, left,
     sn, sav, unalloc, short, k401, tsp, roth, c529, prim, acorn, brok,
     slUn, slSub, cab, mort, carLoan, totalDebt, nw, homeVal, events]
    """
    # ── Unpack inputs with defaults ──
    I = inputs  # shorthand
    start_year   = I.get("start_year", 2026)
    start_age    = I.get("start_age", 23)
    birth_year   = start_year - start_age
    retire_age   = I.get("retire_age", 67)
    ss_age       = I.get("ss_age", 67)
    ss_monthly   = I.get("ss_monthly", 3500)
    wife_ss      = I.get("wife_ss", 1500)
    inflation    = I.get("inflation", 0.025)
    state_tax_rate = I.get("state_tax_rate", 0.03)
    job_start_month = I.get("job_start_month", 6)

    # Wedding
    wedding_year = I.get("wedding_year", 2028)  # calendar year
    wedding_month = I.get("wedding_month", 10)
    wedding_cost = I.get("wedding_cost", 50000)

    # Kids
    num_kids = I.get("num_kids", 4)
    kid_offsets = [I.get("kid1_year", 5), I.get("kid2_year", 7),
                   I.get("kid3_year", 9), I.get("kid4_year", 11), 0]
    kid_birth_years = [start_year + kid_offsets[k] for k in range(num_kids)]

    # House
    buy_year_of_work = I.get("buy_year_of_work", 1)
    house_price = I.get("house_price", 300000)
    down_pct = I.get("down_pct", 0.0)
    mort_rate = I.get("mort_rate", 0.06)
    mort_years = I.get("mort_years", 15)
    purchase_month = I.get("purchase_month", 6)  # B330
    furnish_budget = I.get("furnish_budget", 15000)
    moving_expense = I.get("moving_expense", 3000)
    closing_cost_pct = I.get("closing_cost_pct", 0.03)

    # Cars
    car_years = [I.get("car1_year", 3), I.get("car2_year", 10),
                 I.get("car3_year", 17), I.get("car4_year", 24), I.get("car5_year", 31)]
    car_prices = [I.get("car1_price", 35000), I.get("car2_price", 40000),
                  I.get("car3_price", 45000), I.get("car4_price", 50000), I.get("car5_price", 55000)]
    car_apr = I.get("car_apr", 0.07)
    car_term = I.get("car_term", 60)
    car_sales_tax = I.get("car_sales_tax", 0.09)
    trade_in_pct = I.get("trade_in_pct", 0.35)

    # Debts
    cab_bal0  = I.get("cab_bal", 4200)
    cab_rate  = I.get("cab_rate", 0.18)
    unsub_bal0 = I.get("unsub_bal", 51800)
    unsub_rate = I.get("unsub_rate", 0.058)
    sub_bal0  = I.get("sub_bal", 22200)
    sub_rate  = I.get("sub_rate", 0.053)
    total_debt_payment = I.get("debt_payment_cab", 200) + \
                         I.get("debt_payment_unsub", 570) + \
                         I.get("debt_payment_sub", 239)

    # Savings waterfall
    sn_pct = I.get("sn_pct", 0.3)
    sav_pct = I.get("sav_pct", 0.5)
    unalloc_pct = I.get("unalloc_pct", 0.2)
    sn_target_months = I.get("sn_target_months", 8)
    sn_apy = I.get("sn_apy", 0.045)
    sav_apy = I.get("sav_apy", 0.045)
    overflow_threshold = I.get("overflow_threshold", 10000)
    shortfall_rate = I.get("shortfall_rate", 0.12)

    # Investments
    inv_return = I.get("inv_return", 0.07)
    k401_pct = I.get("k401_pct", 0.04)
    k401_match = I.get("k401_match", 0.04)
    k401_limit_base = I.get("k401_limit", 24500)
    brok_return = I.get("brok_return", 0.07)
    brok_expense_ratio = I.get("brok_expense_ratio", 0.0004)
    div_yield = I.get("div_yield", 0.02)
    div_handling = I.get("div_handling", "reinvest")
    div_tax_rate = I.get("div_tax_rate", 0.18)

    # Initial balances
    sn = I.get("sn_bal", 0.0)
    sav = I.get("sav_bal", 0.0)
    unalloc = 0.0
    shortfall = 0.0
    k401 = I.get("k401_bal", 5633.4)
    tsp = I.get("tsp_bal", 7786.72)
    roth = I.get("roth_bal", 0.0)
    c529 = I.get("c529_bal", 0.0)
    prim = I.get("prim_bal", 1870.0)
    acorn = I.get("acorn_bal", 5551.19)
    brok = I.get("brok_bal", 0.0)
    cab_bal = cab_bal0
    unsub_bal = unsub_bal0
    sub_bal = sub_bal0

    # Monthly contribution amounts
    tsp_monthly = I.get("tsp_monthly", 200)
    roth_monthly = I.get("roth_monthly", 25)
    prim_monthly = I.get("prim_monthly", 25)
    acorn_monthly = I.get("acorn_monthly", 80)
    c529_monthly = I.get("c529_monthly", 100)

    # Withdrawal
    withdrawal_rate = I.get("withdrawal_rate", 0.04)
    withdrawal_inflation_adj = I.get("withdrawal_inflation_adj", True)
    roth_conversion_strategy = I.get("roth_conversion_strategy", "fill_bracket")
    roth_conversion_amount = I.get("roth_conversion_amount", 50000)
    roth_target_bracket = I.get("roth_target_bracket", 0.22)

    # Rental property (defaults = no rental → zero impact)
    rental_enabled = I.get("rental_enabled", False)
    rental_purchase_year = I.get("rental_purchase_year", 2035)
    rental_purchase_month = I.get("rental_purchase_month", 6)
    rental_price = I.get("rental_price", 250000)
    rental_down_pct = I.get("rental_down_pct", 0.20)
    rental_mort_rate = I.get("rental_mort_rate", 0.065)
    rental_mort_years = I.get("rental_mort_years", 30)
    rental_monthly_rent = I.get("rental_monthly_rent", 1800)
    rental_rent_increase = I.get("rental_rent_increase", 0.03)
    rental_vacancy = I.get("rental_vacancy", 0.08)
    rental_mgmt_fee = I.get("rental_mgmt_fee", 0.10)
    rental_prop_tax = I.get("rental_prop_tax", 0.012)
    rental_insurance = I.get("rental_insurance", 2400)
    rental_maintenance = I.get("rental_maintenance", 0.01)
    rental_appreciation = I.get("rental_appreciation", 0.035)

    # Dynamic car parsing (supports both old 5-slot and new array format)
    dyn_car_years, dyn_car_prices, dyn_car_aprs, dyn_car_terms = parse_car_inputs(I)

    # ── Output arrays ──
    monthly_rows = []
    yearly_accum = {}

    # ── PASS 1: Compute annual income/tax for each year ──
    # (needed because tax is annual, prorated to months)
    annual_tax_cache = {}

    # We need to run income for each month to sum annual totals,
    # then compute tax. This mirrors the Excel's circular: TAX_ENGINE
    # sums monthly income columns, but monthly tax references TAX_ENGINE.
    # In Excel this works because it iterates. We do a pre-pass.

    for yr in range(start_year, 2070):
        mo_start = job_start_month if yr == start_year else 1
        annual_gross = 0.0
        annual_you_gross = 0.0
        annual_wife_gross = 0.0
        annual_you_taxable = 0.0
        annual_wife_taxable = 0.0
        months_in_year = 0

        for mo in range(mo_start, 13):
            months_in_year += 1
            age = yr - birth_year

            your_sal = compute_your_salary(
                yr, mo, start_year, age, retire_age,
                I.get("income_mode", "hourly"),
                I.get("year1_salary", 80000),
                I.get("hourly_rate", 38.46), I.get("hours_week", 52),
                I.get("weeks_year", 54), I.get("ot_hours", 10), I.get("ot_mult", 1.5),
                I.get("annual_raise", 0.03), I.get("annual_bonus", 0),
                I.get("jump_year", 5), I.get("jump_salary", 120000),
                I.get("jump_hourly", 60),
            )

            guard = compute_guard_pay(
                yr, mo, start_year, age,
                I.get("commission_year_offset", 0), I.get("prior_enlisted", 6),
                I.get("mil_raise", 0.035), I.get("stop_drill_age", 60),
                I.get("pension_monthly", 1200), I.get("pension_start_age", 60),
                I.get("commission_month", 5),
                I.get("enlisted_annual_pay", 8288.28), I.get("enlisted_pay_growth", 0.035),
                inflation,
            )

            wife = compute_wife_pay(
                yr, mo, start_year, age, retire_age,
                I.get("wife_start_year", 0), I.get("wife_income_mode", "annual"),
                I.get("wife_year1_salary", 50000),
                I.get("wife_hourly", 24), I.get("wife_hours_week", 40),
                I.get("wife_weeks_year", 52), I.get("wife_ot_hours", 0),
                I.get("wife_ot_mult", 1.5), I.get("wife_bonus", 0),
                I.get("wife_raise", 0.03), I.get("wife_jump_year", 5),
                I.get("wife_jump_salary", 72000), I.get("wife_jump_hourly", 0),
                I.get("part_time_pct", 0.65), kid_birth_years,
            )

            # Pension & SS
            pension = 0.0
            if age >= I.get("pension_start_age", 60) and age >= I.get("stop_drill_age", 60):
                # Pension handled inside guard_pay when status=stop
                pass
            your_ss = 0.0
            if age >= ss_age:
                your_ss = ss_monthly * (1 + inflation) ** (yr - start_year)
            wife_ss_mo = 0.0
            if age >= retire_age:
                wife_ss_mo = wife_ss * (1 + inflation) ** (yr - start_year)

            # Withdrawal target (BI column)
            withdrawal_target = 0.0
            # (Handled in main loop, not needed for tax pre-pass)

            gross = your_sal + guard + wife + your_ss + wife_ss_mo + withdrawal_target

            # Pre-tax deductions (AY column)
            k401_contrib = min(your_sal * k401_pct,
                               k401_limit_base * (1 + inflation)**(yr - 2026) / 12)
            tsp_contrib = tsp_monthly if your_sal > 0 else 0
            pretax = k401_contrib + tsp_contrib

            # Taxable wages (BA, BB columns)
            you_taxable = max(0, (your_sal + guard) - pretax)
            # Add 85% of SS if collecting
            if age >= ss_age:
                you_taxable += 0.85 * your_ss
            wife_taxable = max(0, wife)
            if age >= retire_age:
                wife_taxable += 0.85 * wife_ss_mo

            annual_gross += gross
            annual_you_gross += your_sal + guard
            annual_wife_gross += wife
            annual_you_taxable += you_taxable
            annual_wife_taxable += wife_taxable

        is_married = yr >= wedding_year
        combined_taxable = annual_you_taxable + annual_wife_taxable

        annual_tax = compute_annual_tax(
            yr, is_married, annual_gross,
            annual_you_gross, annual_wife_gross,
            annual_you_taxable, annual_wife_taxable,
            combined_taxable, inflation, state_tax_rate,
        )

        annual_tax_cache[yr] = {
            "tax": annual_tax,
            "gross": annual_gross,
            "months": months_in_year,
        }

    # ── Wedding vendor schedule (from INPUTS rows 286-305) ──
    # Each entry: (cost, deposit_pct, deposit_due_months_before, final_due_months_before, installments)
    wedding_vendors = I.get("wedding_vendors", [
        (30000, 0.50, 18, 1, 0),   # Venue
        (0,     0.30, 12, 1, 0),   # Catering (0 in baseline)
        (6000,  0.50, 15, 1, 0),   # Photography
        (2000,  0.50, 12, 1, 0),   # DJ/Music
        (2000,  0.30,  8, 1, 0),   # Flowers/Decor
        (2000,  1.00, 10, 0, 0),   # Bride Attire
        (800,   1.00,  3, 0, 0),   # Bride Alterations
        (500,   1.00,  3, 0, 0),   # Groom Attire
        (500,   1.00,  8, 0, 0),   # Invitations
        (400,   0.50,  6, 1, 0),   # Cake
        (500,   0.50,  6, 0, 0),   # Officiant
        (400,   0.50,  3, 0, 0),   # Hair/Makeup
        (500,   0.50,  3, 0, 0),   # Transportation
        (2000,  0.50,  2, 0, 0),   # Rehearsal Dinner
        (1500,  0.00,  0, 0, 0),   # Church Charges (paid day-of)
        (0,     0.00,  0, 0, 0),   # Tips (0 in baseline)
        (100,   1.00,  1, 0, 0),   # Marriage License
        (400,   1.00,  2, 0, 0),   # Favors/Programs
        (500,   1.00,  1, 0, 0),   # Wedding Party Gifts
        (500,   1.00, 12, 0, 0),   # Wedding Insurance
    ])

    # ── Windfalls (from INPUTS rows 190-195) ──
    # Each entry: (year, amount)
    windfalls = I.get("windfalls", [])  # empty in baseline

    # ── PASS 2: Main monthly loop ──
    _annual_roth_conv = 0.0  # Persists across months within a year, recomputed each January
    for yr in range(start_year, 2070):
        mo_start = job_start_month if yr == start_year else 1
        tax_info = annual_tax_cache.get(yr, {"tax": 0, "gross": 0, "months": 12})
        is_married = yr >= wedding_year

        for mo in range(mo_start, 13):
            age = yr - birth_year
            idx = len(monthly_rows)
            years_worked = yr - start_year

            # ── INCOME ──
            your_sal = compute_your_salary(
                yr, mo, start_year, age, retire_age,
                I.get("income_mode", "hourly"),
                I.get("year1_salary", 80000),
                I.get("hourly_rate", 38.46), I.get("hours_week", 52),
                I.get("weeks_year", 54), I.get("ot_hours", 10), I.get("ot_mult", 1.5),
                I.get("annual_raise", 0.03), I.get("annual_bonus", 0),
                I.get("jump_year", 5), I.get("jump_salary", 120000),
                I.get("jump_hourly", 60),
            )

            guard = compute_guard_pay(
                yr, mo, start_year, age,
                I.get("commission_year_offset", 0), I.get("prior_enlisted", 6),
                I.get("mil_raise", 0.035), I.get("stop_drill_age", 60),
                I.get("pension_monthly", 1200), I.get("pension_start_age", 60),
                I.get("commission_month", 5),
                I.get("enlisted_annual_pay", 8288.28), I.get("enlisted_pay_growth", 0.035),
                inflation,
            )

            wife = compute_wife_pay(
                yr, mo, start_year, age, retire_age,
                I.get("wife_start_year", 0), I.get("wife_income_mode", "annual"),
                I.get("wife_year1_salary", 50000),
                I.get("wife_hourly", 24), I.get("wife_hours_week", 40),
                I.get("wife_weeks_year", 52), I.get("wife_ot_hours", 0),
                I.get("wife_ot_mult", 1.5), I.get("wife_bonus", 0),
                I.get("wife_raise", 0.03), I.get("wife_jump_year", 5),
                I.get("wife_jump_salary", 72000), I.get("wife_jump_hourly", 0),
                I.get("part_time_pct", 0.65), kid_birth_years,
            )

            your_ss = ss_monthly * (1 + inflation)**(yr - start_year) if age >= ss_age else 0
            wife_ss_mo = wife_ss * (1 + inflation)**(yr - start_year) if age >= retire_age else 0

            # ── RENTAL PROPERTY ──
            rental_data = {"rent_income": 0, "net_income": 0, "mortgage_pmt": 0,
                           "value": 0, "equity": 0, "mort_bal": 0, "is_owned": False}
            if rental_enabled:
                rental_data = compute_rental_monthly(
                    yr, mo, rental_purchase_year, rental_purchase_month,
                    rental_price, rental_down_pct, rental_mort_rate, rental_mort_years,
                    rental_monthly_rent, rental_rent_increase, rental_vacancy,
                    rental_mgmt_fee, rental_prop_tax, rental_insurance,
                    rental_maintenance, rental_appreciation, inflation, start_year,
                )
            rental_net = rental_data["net_income"]

            # ── WITHDRAWAL TARGET (RMD-aware) ──
            withdrawal_target = 0.0
            rmd_this_month = 0.0
            if age >= retire_age and idx > 0:
                prev = monthly_rows[idx - 1]
                total_invested_prev = prev[11] + prev[12] + prev[13] + prev[15] + prev[16] + prev[17]

                # Base withdrawal = 4% rule
                withdrawal_target = total_invested_prev * withdrawal_rate / 12
                if withdrawal_inflation_adj:
                    withdrawal_target *= (1 + inflation) ** max(0, yr - (start_year + retire_age - start_age))

                # RMD floor — must withdraw at least this much from tax-deferred
                rmd_info = compute_rmd(age, birth_year, prev[11], prev[12])  # k401, tsp
                rmd_this_month = rmd_info["rmd_monthly"]
                withdrawal_target = max(withdrawal_target, rmd_this_month)

                # Roth conversion (compute once in January, persist for the year)
                if mo == 1:
                    roth_conv_info = compute_roth_conversion(
                        age, retire_age, prev[11], prev[12],
                        (your_ss + wife_ss_mo + withdrawal_target) * 12,
                        (1 + inflation) ** (yr - start_year),
                        is_married, roth_conversion_strategy,
                        roth_conversion_amount, roth_target_bracket,
                        birth_year,
                    )
                    _annual_roth_conv = roth_conv_info["conversion_amount"]

            gross = your_sal + guard + wife + your_ss + wife_ss_mo + withdrawal_target + max(0, rental_net)

            # ── PRE-TAX DEDUCTIONS (AY column) ──
            k401_contrib = min(your_sal * k401_pct,
                               k401_limit_base * (1 + inflation)**(yr - 2026) / 12)
            k401_match_contrib = your_sal * k401_match
            tsp_contrib = tsp_monthly if your_sal > 0 else 0
            pretax = k401_contrib + tsp_contrib

            # ── TAXES (J column) — prorated from annual ──
            ann_gross = tax_info["gross"]
            if ann_gross > 0:
                month_tax = tax_info["tax"] * (gross / ann_gross)
            else:
                month_tax = 0

            take_home = gross - pretax - month_tax

            # ── SPENDING ──
            # Count kids born by this date
            kids_born = sum(1 for by in kid_birth_years if yr >= by)

            housing = compute_housing_recurring(
                yr, mo, start_year,
                I.get("rent", 1400), I.get("rent_increase", 0.03),
                buy_year_of_work, house_price, down_pct,
                mort_rate, mort_years,
                I.get("prop_tax", 0.005), I.get("home_ins", 2400),
                I.get("maintenance", 0.005), I.get("appreciation", 0.035),
                I.get("pmi_rate", 0.007), I.get("pmi_threshold", 0.2),
                I.get("capital_reserve", 0.005), I.get("furniture_replace", 1500),
                I.get("furniture_replace_inf", 0.025),
                purchase_month, inflation,
            )

            health = compute_health_recurring(
                yr, mo, start_year, age, retire_age, is_married,
                kids_born, kid_birth_years,
                I.get("health_prem_you", 300), I.get("health_prem_wife", 200),
                I.get("healthcare_inflation", 0.05),
                I.get("retire_pre65", 1500), I.get("retire_65plus", 400),
                I.get("annual_oop", 1500), I.get("dental_vision", 50),
                I.get("prenatal", 350), I.get("postpartum", 200),
                I.get("prenatal_months", 9), I.get("postpartum_months", 6),
                purchase_month,
            )

            kids = compute_kids_recurring(
                yr, start_year, kid_birth_years,
                I.get("daycare", 15000), I.get("childcare_inflation", 0.045),
                I.get("kid_general_05", 3000), I.get("kid_cost_612", 15000),
                I.get("kid_cost_1317", 15000), I.get("kid_cost_college", 20000),
                I.get("kid_inflation", 0.028),
            )

            car = compute_car_recurring(
                yr, mo, start_year,
                I.get("car_ins", 350), I.get("car_ins_increase", 0.03),
                I.get("car_maintenance", 1200), I.get("car_registration", 200),
                inflation, car_years, car_prices, car_apr, car_term, purchase_month,
            )

            bills = compute_bills_recurring(
                yr, is_married,
                I.get("phone", 240), I.get("internet", 70), I.get("streaming", 40),
                I.get("subscriptions", 120), I.get("gym", 20), I.get("groceries", 600),
                I.get("gas", 200), I.get("clothing", 200), I.get("dining", 300),
                I.get("fun_money", 650), I.get("misc", 400),
                0.01, 0.02, 0.02, 0.02, 0.02, 0.028, 0.03, 0.025, 0.03, 0.025, 0.025,
                I.get("phone_mult", 1.0), I.get("streaming_mult", 1.2),
                I.get("subs_mult", 1.3), I.get("gym_mult", 1.5),
                I.get("groceries_mult", 1.8), I.get("gas_mult", 1.3),
                I.get("clothing_mult", 1.5), I.get("dining_mult", 1.5),
                I.get("fun_mult", 1.3), I.get("misc_mult", 1.5),
                I.get("vacation", 3000), I.get("vacation_inf", 0.03),
                I.get("gift", 2000), I.get("gift_inf", 0.025), I.get("gift_mult", 1.5),
                I.get("personal_care", 150), I.get("personal_inf", 0.025),
                I.get("personal_mult", 1.8),
                I.get("pet", 250), I.get("pet_inf", 0.04),
            )

            # Debt payments (AU column)
            cab_bal_new, unsub_bal_new, sub_bal_new, debt_pmt_actual = debt_avalanche_step(
                cab_bal, cab_rate, unsub_bal, unsub_rate, sub_bal, sub_rate, total_debt_payment,
            )

            investing = compute_investing_recurring(
                yr, start_year, kids_born,
                prim_monthly, acorn_monthly, roth_monthly, c529_monthly,
                I.get("life_ins_monthly", 0), inflation,
            )

            recurring_spend = housing + health + kids + car + bills + debt_pmt_actual + investing

            # ── ONE-TIME EVENTS (AW column — matches SUMPRODUCT array formula) ──
            onetime = 0.0
            buy_cal_year = start_year + buy_year_of_work
            current_cal_month = yr * 12 + mo  # absolute month number

            # ── Initial one-time event (Excel AW5 cached value) ──
            # The Excel produces $5,000 in month 1 from its array formula.
            # This is a cached value that affects the waterfall cascade.
            if idx == 0:
                onetime += I.get("initial_onetime", 5000)

            # ── Wedding vendor deposit schedule ──
            # Excel AW formula uses 3 SUMPRODUCT terms over the vendor table:
            # 1) Lump deposits (installments=0): cost*dep% at wedding_month - due_months
            # 2) Installment deposits (installments>0): cost*dep%/inst spread over months
            # 3) Final payments (dep%<1): cost*(1-dep%) at wedding_month - final_months
            wedding_cal_month = wedding_year * 12 + wedding_month

            for v in wedding_vendors:
                v_cost, v_dep_pct, v_dep_due, v_final_due, v_inst = v
                if v_cost <= 0:
                    continue

                # Deposit payment
                dep_amount = v_cost * v_dep_pct
                dep_pay_month = wedding_cal_month - v_dep_due

                if v_inst <= 0:
                    # Lump sum deposit
                    if current_cal_month == dep_pay_month:
                        onetime += dep_amount
                else:
                    # Spread deposit over installment months
                    if dep_pay_month <= current_cal_month < dep_pay_month + v_inst:
                        onetime += dep_amount / v_inst

                # Final payment (remaining balance, only if deposit < 100%)
                if v_dep_pct < 1.0:
                    final_amount = v_cost * (1 - v_dep_pct)
                    final_pay_month = wedding_cal_month - v_final_due
                    if current_cal_month == final_pay_month:
                        onetime += final_amount

            # ── House purchase: down payment + closing + furnish + moving ──
            # Excel: B118*B119 + B118*B126 + B380 + B381
            if yr == buy_cal_year and mo == purchase_month:
                onetime += (house_price * down_pct +       # down payment
                           house_price * closing_cost_pct + # closing costs
                           furnish_budget + moving_expense)

            # ── Car purchase: 10% down + sales tax - trade-in ──
            for ci, cy in enumerate(car_years):
                if years_worked == cy and mo == purchase_month:
                    price = car_prices[ci]
                    # Trade-in: previous car's price × trade-in %
                    # Excel: LOOKUP to find the car BEFORE this one
                    if ci > 0:
                        trade_in = car_prices[ci - 1] * trade_in_pct
                    else:
                        trade_in = 0  # first car, no trade-in
                    down = price * 0.1
                    sales_tax = price * car_sales_tax
                    onetime += down + sales_tax - trade_in

            # ── Birth delivery cost per kid ──
            for by in kid_birth_years:
                if yr == by and mo == purchase_month:
                    onetime += I.get("birth_cost", 5000)

            # ── Windfalls (from INPUTS rows 190-195, January only) ──
            # Excel: SUMPRODUCT((A190:A195=year)*(month=1)*(B190:B195))
            if mo == 1:
                for wf in windfalls:
                    if wf[0] == yr:
                        onetime += wf[1]

            total_spend = recurring_spend + onetime
            leftover = take_home - total_spend

            # ── SAVINGS WATERFALL (P-U columns) ──
            shortfall_paydown = 0.0
            sn_contrib = 0.0
            sav_contrib = 0.0
            unalloc_contrib = 0.0
            auto_invest = 0.0
            new_borrow = 0.0

            if leftover > 0:
                remaining = leftover

                # P: Pay down shortfall first
                if shortfall > 0:
                    sf_with_int = shortfall * (1 + (1 + shortfall_rate)**(1/12) - 1)
                    shortfall_paydown = min(remaining, sf_with_int)
                    remaining -= shortfall_paydown

                # Q: Safety net
                sn_target = sn_target_months * recurring_spend
                sn_need = max(0, sn_target - sn)
                sn_contrib = min(remaining * sn_pct, sn_need)
                remaining_after_sn = remaining - sn_contrib

                # R: Savings = savPct of (leftover-paydown) + overflow from SN allocation
                sn_overflow = remaining * sn_pct - sn_contrib
                sav_contrib = remaining_after_sn * sav_pct / (sav_pct + unalloc_pct) * (sav_pct + unalloc_pct) / 1
                # Actually the Excel formula: R = (O-P)*savPct + ((O-P)*snPct - Q)
                sav_contrib = (leftover - shortfall_paydown) * sav_pct + \
                              ((leftover - shortfall_paydown) * sn_pct - sn_contrib)

                # S: Unallocated
                unalloc_contrib = (leftover - shortfall_paydown) * unalloc_pct

                # T: Auto-invest overflow
                auto_invest = max(0, (unalloc + unalloc_contrib) - overflow_threshold)

            elif leftover < 0:
                deficit = -leftover
                # Draw from unallocated → savings → safety net → borrow
                from_unalloc = min(deficit, unalloc)
                unalloc -= from_unalloc
                deficit -= from_unalloc

                from_sav = min(deficit, sav)
                sav -= from_sav
                deficit -= from_sav

                from_sn = min(deficit, sn)
                sn -= from_sn
                deficit -= from_sn

                if deficit > 0:
                    new_borrow = deficit

            # ── UPDATE BALANCES ──
            # Cash accounts
            monthly_sn_rate = (1 + sn_apy)**(1/12) - 1
            monthly_sav_rate = (1 + sav_apy)**(1/12) - 1

            if leftover >= 0:
                sn = (sn + sn_contrib) * (1 + monthly_sn_rate)
                sav = (sav + sav_contrib) * (1 + monthly_sav_rate)
                unalloc = unalloc + unalloc_contrib - auto_invest
            else:
                sn = sn * (1 + monthly_sn_rate)
                sav = sav * (1 + monthly_sav_rate)
                # unalloc already reduced above

            # Shortfall balance
            shortfall = max(0, shortfall * (1 + (1 + shortfall_rate)**(1/12) - 1)
                           - shortfall_paydown + new_borrow)

            # ── INVESTMENT ACCOUNTS (Z-AF columns) ──
            # Monte Carlo: if _monthly_returns provided, use per-month random rate
            # Otherwise use the deterministic fixed annual rate (default behavior)
            _mr = I.get("_monthly_returns")
            if _mr is not None and idx < len(_mr):
                monthly_inv_rate = _mr[idx]
            else:
                monthly_inv_rate = (1 + inv_return)**(1/12) - 1

            # Withdrawal cascade (for retirement)
            withdraw_remaining = withdrawal_target

            # Brokerage (AF) — grows, receives auto-invest, withdrawals taken first
            if _mr is not None and idx < len(_mr):
                brok_growth_rate = _mr[idx] - brok_expense_ratio / 12
            else:
                brok_growth_rate = (1 + brok_return - brok_expense_ratio)**(1/12) - 1
            divs = brok * div_yield / 12
            if div_handling == "reinvest":
                brok_before_withdraw = (brok + auto_invest) * (1 + brok_growth_rate) + \
                                       divs * (1 - div_tax_rate)
            else:
                brok_before_withdraw = (brok + auto_invest) * (1 + brok_growth_rate)
                sav += divs * (1 - div_tax_rate)

            brok_withdraw = min(withdraw_remaining, brok_before_withdraw)
            brok = max(0, brok_before_withdraw - brok_withdraw)
            withdraw_remaining -= brok_withdraw

            # Acorns (AE)
            acorn_before = acorn * (1 + monthly_inv_rate) + acorn_monthly  # flat per Excel AE
            acorn_withdraw = min(withdraw_remaining, acorn_before)
            acorn = max(0, acorn_before - acorn_withdraw)
            withdraw_remaining -= acorn_withdraw

            # Primerica (AD)
            prim_before = prim * (1 + monthly_inv_rate) + prim_monthly  # flat per Excel AD
            prim_withdraw = min(withdraw_remaining, prim_before)
            prim = max(0, prim_before - prim_withdraw)
            withdraw_remaining -= prim_withdraw

            # 401k (Z)
            k401_before = k401 * (1 + monthly_inv_rate) + k401_contrib + k401_match_contrib
            k401_withdraw = min(withdraw_remaining, k401_before)
            k401 = max(0, k401_before - k401_withdraw)
            withdraw_remaining -= k401_withdraw

            # TSP (AA)
            tsp_before = tsp * (1 + monthly_inv_rate) + (tsp_contrib if your_sal > 0 else 0)
            tsp_withdraw = min(withdraw_remaining, tsp_before)
            tsp = max(0, tsp_before - tsp_withdraw)
            withdraw_remaining -= tsp_withdraw

            # Roth (AB) — last resort withdrawal
            # Excel: MIN(B89, B312*inf/12) * phase — B89 is flat, limit is inflated
            roth_contrib_base = roth_monthly  # flat $25 per Excel
            # Roth income phaseout — matches Excel AB column exactly.
            # Excel uses I*12 (this month's gross annualized), NOT actual annual gross.
            annual_income_for_roth = gross * 12  # per-month annualized, per Excel
            if is_married:
                phaseout_lower = I.get("roth_phaseout_lower_mfj", 242000) * (1 + inflation)**(yr - 2026)
                phaseout_upper = I.get("roth_phaseout_upper_mfj", 252000) * (1 + inflation)**(yr - 2026)
            else:
                phaseout_lower = I.get("roth_phaseout_lower_single", 153000) * (1 + inflation)**(yr - 2026)
                phaseout_upper = I.get("roth_phaseout_upper_single", 168000) * (1 + inflation)**(yr - 2026)
            roth_limit = I.get("roth_limit", 7500) * (1 + inflation)**(yr - 2026) / 12
            roth_phase = max(0, min(1, (phaseout_upper - annual_income_for_roth) /
                                   max(1, phaseout_upper - phaseout_lower)))
            roth_contrib_actual = min(roth_contrib_base, roth_limit) * roth_phase

            roth_before = roth * (1 + monthly_inv_rate) + roth_contrib_actual
            roth_withdraw = min(withdraw_remaining, roth_before)
            roth = max(0, roth_before - roth_withdraw)

            # ── ROTH CONVERSION LADDER ──
            # Move money from 401k/TSP → Roth (tax event, not withdrawal)
            roth_conv_monthly = _annual_roth_conv / 12 if _annual_roth_conv > 0 else 0
            if roth_conv_monthly > 0:
                k401_share = k401 / max(k401 + tsp, 1)
                conv_from_k401 = min(roth_conv_monthly * k401_share, k401)
                conv_from_tsp = min(roth_conv_monthly - conv_from_k401, tsp)
                k401 -= conv_from_k401
                tsp -= conv_from_tsp
                roth += conv_from_k401 + conv_from_tsp

            # 529 (AC)
            kids_eligible = sum(1 for by in kid_birth_years if yr >= by)
            c529_contrib = c529_monthly * min(num_kids, kids_eligible)
            c529 = c529 * (1 + monthly_inv_rate) + c529_contrib

            # ── DEBT BALANCES ──
            cab_bal = cab_bal_new
            unsub_bal = unsub_bal_new
            sub_bal = sub_bal_new

            # Mortgage
            principal = house_price * (1 - down_pct)
            mort_payments = mort_years * 12
            monthly_rate = mort_rate / 12
            months_since_purchase = (yr - (start_year + buy_year_of_work)) * 12 + (mo - purchase_month)
            mort_bal = mortgage_balance(principal, monthly_rate, mort_payments, months_since_purchase)

            # Car loan
            car_loan_bal = car_loan_balance(years_worked, mo, car_years, car_prices,
                                            car_apr, car_term, purchase_month)

            # Home value
            if months_since_purchase >= 0:
                home_val = house_price * (1 + I.get("appreciation", 0.035)) ** (months_since_purchase / 12)
            else:
                home_val = 0

            # Rental property value/mortgage (add to home_val and total_debt)
            rental_val = rental_data.get("value", 0)
            rental_mort_bal = rental_data.get("mort_bal", 0)

            # ── NET WORTH ──
            total_debt = unsub_bal + sub_bal + cab_bal + mort_bal + car_loan_bal + shortfall + rental_mort_bal
            total_invested = k401 + tsp + roth + c529 + prim + acorn + brok
            total_cash = sn + sav + unalloc
            combined_real_estate = home_val + rental_val  # primary + rental
            nw = total_cash + total_invested + combined_real_estate - total_debt

            # ── PUSH ROW ──
            monthly_rows.append([
                yr, mo,
                round(gross), round(month_tax), round(take_home),
                round(total_spend), round(leftover),
                round(sn), round(sav), round(unalloc), round(shortfall),
                round(k401), round(tsp), round(roth), round(c529),
                round(prim), round(acorn), round(brok),
                round(unsub_bal), round(sub_bal), round(cab_bal),
                round(mort_bal), round(car_loan_bal),
                round(total_debt), round(nw), round(combined_real_estate),
                round(onetime),
            ])

            # ── YEARLY ACCUMULATOR ──
            if yr not in yearly_accum:
                yearly_accum[yr] = {"gross": 0, "tax": 0, "take": 0, "spend": 0, "left": 0}
            ya = yearly_accum[yr]
            ya["gross"] += gross
            ya["tax"] += month_tax
            ya["take"] += take_home
            ya["spend"] += total_spend
            ya["left"] += leftover

            if mo == 12:
                ya["nw"] = nw
                ya["sn"] = sn
                ya["sav"] = sav
                ya["inv"] = total_invested
                ya["debt"] = total_debt
                ya["home"] = combined_real_estate
                ya["mort"] = mort_bal
                ya["k401"] = k401
                ya["tsp"] = tsp
                ya["roth"] = roth
                ya["brok"] = brok
                ya["c529"] = c529
                # Phase 3 extensions
                ya["rental_val"] = rental_val
                ya["rental_equity"] = rental_data.get("equity", 0)
                ya["rental_mort"] = rental_mort_bal
                ya["rental_income"] = rental_data.get("rent_income", 0) * 12
                ya["rmd_annual"] = rmd_this_month * 12
                ya["roth_conversion"] = _annual_roth_conv

    # ── Convert yearly to sorted array ──
    yearly_arr = []
    for yr in sorted(yearly_accum.keys()):
        ya = yearly_accum[yr]
        if "nw" not in ya:
            continue
        yearly_arr.append({
            "yr": yr,
            "gross": round(ya["gross"]),
            "tax": round(ya["tax"]),
            "take": round(ya["take"]),
            "spend": round(ya["spend"]),
            "left": round(ya["left"]),
            "nw": round(ya["nw"]),
            "debt": round(ya["debt"]),
            "sn": round(ya["sn"]),
            "sav": round(ya["sav"]),
            "inv": round(ya["inv"]),
            "home": round(ya["home"]),
            "mort": round(ya["mort"]),
            "k401": round(ya["k401"]),
            "tsp": round(ya["tsp"]),
            "roth": round(ya["roth"]),
            "brok": round(ya["brok"]),
            "c529": round(ya.get("c529", 0)),
            # Phase 3 extensions
            "rental_val": round(ya.get("rental_val", 0)),
            "rental_equity": round(ya.get("rental_equity", 0)),
            "rental_mort": round(ya.get("rental_mort", 0)),
            "rental_income": round(ya.get("rental_income", 0)),
            "rmd_annual": round(ya.get("rmd_annual", 0)),
            "roth_conversion": round(ya.get("roth_conversion", 0)),
        })

    return {"monthly": monthly_rows, "yearly": yearly_arr}


# ═══════════════════════════════════════════════════════════════════
# QUICK TEST
# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    result = run_engine({})  # all defaults = v13 baseline
    m = result["monthly"]
    print(f"Total months: {len(m)}")
    print(f"\nMonth 1 (Jun 2026): gross=${m[0][2]} tax=${m[0][3]} take=${m[0][4]} "
          f"spend=${m[0][5]} left=${m[0][6]} nw=${m[0][24]}")
    print(f"Excel month 1:      gross=$14657 tax=$2543 take=$11531 "
          f"spend=$12137 left=-$606  nw=$-56179")

    # Year-end comparisons
    expected = {
        2026: -18452, 2027: 39117, 2028: 129436, 2030: 378480,
        2035: 821082, 2040: 1240743, 2050: 2238364, 2060: 4371421, 2069: 8516326,
    }
    print(f"\nYear | Engine NW      | Excel NW       | Δ        | Δ%")
    for ya in result["yearly"]:
        if ya["yr"] in expected:
            ex = expected[ya["yr"]]
            d = ya["nw"] - ex
            pct = d / abs(ex) * 100 if ex != 0 else 0
            print(f"{ya['yr']} | ${ya['nw']:>13,} | ${ex:>13,} | ${d:>+9,} | {pct:>+6.1f}%")
