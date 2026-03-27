"""
Financial Plan v13 — FastAPI Backend
Endpoints: simulate, monte-carlo, auth, plan CRUD, sharing.

Usage:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Tuple
import time
import secrets
import json

import os
from engine import run_engine
from monte_carlo import run_monte_carlo
from database import get_db, User, Plan, SharedLink
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_user,
)
from sqlalchemy.orm import Session

app = FastAPI(title="Financial Command Center", version="2.0.0")

# CORS
_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
_origins = [o.strip() for o in _origins_env.split(",") if o.strip()] if _origins_env else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


class SimulationInputs(BaseModel):
    """All ~80 input parameters with v13 defaults."""

    # ── Core ──
    start_year: int = 2026
    start_age: int = 23
    retire_age: int = 67
    ss_age: int = 67
    ss_monthly: float = 3500
    wife_ss: float = 1500
    inflation: float = 0.025
    state_tax_rate: float = 0.03
    job_start_month: int = 6

    # ── Your Income ──
    income_mode: str = "hourly"
    year1_salary: float = 80000
    hourly_rate: float = 38.46
    hours_week: float = 52
    weeks_year: float = 54
    ot_hours: float = 10
    ot_mult: float = 1.5
    annual_raise: float = 0.03
    annual_bonus: float = 0
    jump_year: int = 5
    jump_salary: float = 120000
    jump_hourly: float = 60

    # ── Wife Income ──
    wife_start_year: int = 0
    wife_income_mode: str = "annual"
    wife_year1_salary: float = 50000
    wife_hourly: float = 24
    wife_hours_week: float = 40
    wife_weeks_year: float = 52
    wife_ot_hours: float = 0
    wife_ot_mult: float = 1.5
    wife_bonus: float = 0
    wife_raise: float = 0.03
    wife_jump_year: int = 5
    wife_jump_salary: float = 72000
    wife_jump_hourly: float = 0
    part_time_pct: float = 0.65

    # ── Wedding ──
    wedding_year: int = 2028
    wedding_month: int = 10
    wedding_cost: float = 50000

    # ── Guard / Military ──
    commission_year_offset: int = 0
    prior_enlisted: int = 6
    mil_raise: float = 0.035
    stop_drill_age: int = 60
    pension_monthly: float = 1200
    pension_start_age: int = 60
    commission_month: int = 5
    enlisted_annual_pay: float = 8288.28
    enlisted_pay_growth: float = 0.035

    # ── Housing ──
    rent: float = 1400
    rent_increase: float = 0.03
    buy_year_of_work: int = 1
    house_price: float = 300000
    down_pct: float = 0.0
    mort_rate: float = 0.06
    mort_years: int = 15
    prop_tax: float = 0.005
    home_ins: float = 2400
    maintenance: float = 0.005
    appreciation: float = 0.035
    pmi_rate: float = 0.007
    pmi_threshold: float = 0.2
    closing_cost_pct: float = 0.03
    furnish_budget: float = 15000
    moving_expense: float = 3000
    capital_reserve: float = 0.005
    furniture_replace: float = 1500
    furniture_replace_inf: float = 0.025
    purchase_month: int = 6

    # ── Kids ──
    num_kids: int = 4
    kid1_year: int = 5
    kid2_year: int = 7
    kid3_year: int = 9
    kid4_year: int = 11
    daycare: float = 15000
    childcare_inflation: float = 0.045
    kid_general_05: float = 3000
    kid_cost_612: float = 15000
    kid_cost_1317: float = 15000
    kid_cost_college: float = 20000
    kid_inflation: float = 0.028
    birth_cost: float = 5000

    # ── Investments ──
    k401_pct: float = 0.04
    k401_match: float = 0.04
    inv_return: float = 0.07
    k401_bal: float = 5633.4
    tsp_bal: float = 7786.72
    roth_bal: float = 0.0
    c529_bal: float = 0.0
    prim_bal: float = 1870.0
    acorn_bal: float = 5551.19
    brok_bal: float = 0.0
    tsp_monthly: float = 200
    roth_monthly: float = 25
    prim_monthly: float = 25
    acorn_monthly: float = 80
    c529_monthly: float = 100
    k401_limit: float = 24500
    roth_limit: float = 7500
    brok_return: float = 0.07
    brok_expense_ratio: float = 0.0004
    div_yield: float = 0.02
    div_handling: str = "reinvest"
    div_tax_rate: float = 0.18

    # ── Savings Waterfall ──
    sn_pct: float = 0.3
    sav_pct: float = 0.5
    unalloc_pct: float = 0.2
    sn_target_months: int = 8
    sn_apy: float = 0.045
    sav_apy: float = 0.045
    sn_bal: float = 0.0
    sav_bal: float = 0.0
    overflow_threshold: float = 10000
    shortfall_rate: float = 0.12

    # ── Debts ──
    cab_bal: float = 4200
    cab_rate: float = 0.18
    unsub_bal: float = 51800
    unsub_rate: float = 0.058
    sub_bal: float = 22200
    sub_rate: float = 0.053
    debt_payment_cab: float = 200
    debt_payment_unsub: float = 570
    debt_payment_sub: float = 239

    # ── Bills ──
    phone: float = 240
    internet: float = 70
    streaming: float = 40
    subscriptions: float = 120
    gym: float = 20
    groceries: float = 600
    gas: float = 200
    clothing: float = 200
    dining: float = 300
    fun_money: float = 650
    misc: float = 400

    # ── Marriage multipliers ──
    phone_mult: float = 1.0
    streaming_mult: float = 1.2
    subs_mult: float = 1.3
    gym_mult: float = 1.5
    groceries_mult: float = 1.8
    gas_mult: float = 1.3
    clothing_mult: float = 1.5
    dining_mult: float = 1.5
    fun_mult: float = 1.3
    misc_mult: float = 1.5

    # ── Healthcare ──
    health_prem_you: float = 300
    health_prem_wife: float = 200
    healthcare_inflation: float = 0.05
    retire_pre65: float = 1500
    retire_65plus: float = 400
    annual_oop: float = 1500
    dental_vision: float = 50
    prenatal: float = 350
    postpartum: float = 200
    prenatal_months: int = 9
    postpartum_months: int = 6

    # ── Cars ──
    car_ins: float = 350
    car_ins_increase: float = 0.03
    car1_year: int = 3
    car1_price: float = 35000
    car2_year: int = 10
    car2_price: float = 40000
    car3_year: int = 17
    car3_price: float = 45000
    car4_year: int = 24
    car4_price: float = 50000
    car5_year: int = 31
    car5_price: float = 55000
    car_apr: float = 0.07
    car_term: int = 60
    car_sales_tax: float = 0.09
    car_maintenance: float = 1200
    car_registration: float = 200
    trade_in_pct: float = 0.35

    # ── Other ──
    vacation: float = 3000
    vacation_inf: float = 0.03
    gift: float = 2000
    gift_inf: float = 0.025
    gift_mult: float = 1.5
    personal_care: float = 150
    personal_inf: float = 0.025
    personal_mult: float = 1.8
    pet: float = 250
    pet_inf: float = 0.04
    life_ins_monthly: float = 0

    # ── Roth phaseout ──
    roth_phaseout_lower_single: float = 153000
    roth_phaseout_upper_single: float = 168000
    roth_phaseout_lower_mfj: float = 242000
    roth_phaseout_upper_mfj: float = 252000

    # ── Withdrawal ──
    withdrawal_rate: float = 0.04
    withdrawal_inflation_adj: bool = True

    # ── Roth Conversion Ladder ──
    roth_conversion_strategy: str = "fill_bracket"  # "fill_bracket", "fixed", "none"
    roth_conversion_amount: float = 50000            # annual amount for "fixed" strategy
    roth_target_bracket: float = 0.22                # fill up to this bracket

    # ── Rental Property ──
    rental_enabled: bool = False
    rental_purchase_year: int = 2035
    rental_purchase_month: int = 6
    rental_price: float = 250000
    rental_down_pct: float = 0.20
    rental_mort_rate: float = 0.065
    rental_mort_years: int = 30
    rental_monthly_rent: float = 1800
    rental_rent_increase: float = 0.03
    rental_vacancy: float = 0.08
    rental_mgmt_fee: float = 0.10
    rental_prop_tax: float = 0.012
    rental_insurance: float = 2400
    rental_maintenance: float = 0.01
    rental_appreciation: float = 0.035

    # ── Dynamic Cars (alternative to fixed car1-car5 slots) ──
    cars: Optional[list] = None  # [{year, price, apr, term}, ...]

    # ── Initial one-time (Excel cached value) ──
    initial_onetime: float = 5000

    @model_validator(mode="after")
    def validate_inputs(self):
        if self.retire_age <= self.start_age:
            raise ValueError(f"retire_age ({self.retire_age}) must be greater than start_age ({self.start_age})")
        if not (0 <= self.mort_rate <= 0.15):
            raise ValueError(f"mort_rate ({self.mort_rate}) must be between 0 and 0.15")
        if not (0 <= self.inflation <= 0.10):
            raise ValueError(f"inflation ({self.inflation}) must be between 0 and 0.10")
        if not (0 <= self.k401_pct <= 1.0):
            raise ValueError(f"k401_pct ({self.k401_pct}) must be between 0 and 1.0")
        if not (0 <= self.down_pct <= 1.0):
            raise ValueError(f"down_pct ({self.down_pct}) must be between 0 and 1.0")
        if not (0 <= self.inv_return <= 0.30):
            raise ValueError(f"inv_return ({self.inv_return}) must be between 0 and 0.30")
        if not (0 <= self.state_tax_rate <= 0.15):
            raise ValueError(f"state_tax_rate ({self.state_tax_rate}) must be between 0 and 0.15")
        if self.ss_age < 62 or self.ss_age > 72:
            raise ValueError(f"ss_age ({self.ss_age}) must be between 62 and 72")
        if self.mort_years not in (15, 20, 25, 30):
            raise ValueError(f"mort_years ({self.mort_years}) must be 15, 20, 25, or 30")
        if self.num_kids < 0 or self.num_kids > 5:
            raise ValueError(f"num_kids ({self.num_kids}) must be between 0 and 5")
        return self


class SimulationResponse(BaseModel):
    monthly: list
    yearly: list
    metadata: dict


@app.post("/simulate", response_model=SimulationResponse)
def simulate(inputs: SimulationInputs):
    """Run the 523-month financial simulation."""
    start = time.perf_counter()

    # Convert Pydantic model to dict for the engine
    inp_dict = inputs.model_dump()
    result = run_engine(inp_dict)

    elapsed_ms = (time.perf_counter() - start) * 1000

    return SimulationResponse(
        monthly=result["monthly"],
        yearly=result["yearly"],
        metadata={
            "months": len(result["monthly"]),
            "years": len(result["yearly"]),
            "elapsed_ms": round(elapsed_ms, 1),
            "engine_version": "1.0.0",
        },
    )


@app.get("/defaults")
def get_defaults():
    """Return all default input values."""
    return SimulationInputs().model_dump()


@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok", "engine": "v13-python", "version": "1.1.0"}


class MonteCarloInputs(BaseModel):
    """Inputs for Monte Carlo simulation."""
    num_sims: int = Field(default=200, ge=10, le=1000, description="Number of simulations")
    annual_vol: float = Field(default=0.16, ge=0.05, le=0.40, description="Annual return volatility (S&P historical ~0.16)")
    # All the same financial inputs as SimulationInputs
    # We inherit them by accepting extra kwargs
    inputs: Optional[dict] = Field(default=None, description="Financial plan inputs (same as /simulate)")


class MonteCarloResponse(BaseModel):
    """Response from Monte Carlo simulation."""
    num_sims: int
    elapsed_ms: int
    years: list
    deterministic: dict
    percentiles: dict
    probabilities: dict


@app.post("/monte-carlo", response_model=MonteCarloResponse)
def monte_carlo(mc_inputs: MonteCarloInputs):
    """
    Run Monte Carlo simulation with randomized investment returns.

    Returns P10/P25/P50/P75/P90 percentile bands for yearly net worth,
    plus probability metrics (chance of hitting $1M, $2M, $5M, $8M).

    Performance: ~200 sims in ~4 seconds, ~500 sims in ~10 seconds.
    """
    # Merge user inputs with defaults
    base = SimulationInputs()
    inp_dict = base.model_dump()
    if mc_inputs.inputs:
        inp_dict.update(mc_inputs.inputs)

    # Pass annual volatility for return generation
    inp_dict["_annual_vol"] = mc_inputs.annual_vol

    result = run_monte_carlo(
        inputs=inp_dict,
        num_sims=mc_inputs.num_sims,
    )

    return MonteCarloResponse(**result)


# ═══════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token: str
    user: dict

class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    created_at: str


@app.post("/auth/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """Create a new user account."""
    # Check if email already exists
    existing = db.query(User).filter(User.email == req.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user = User(
        email=req.email.lower().strip(),
        hashed_password=hash_password(req.password),
        display_name=req.display_name or req.email.split("@")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create a default plan for the new user
    default_plan = Plan(
        user_id=user.id,
        name="My Plan",
        inputs_json=json.dumps(SimulationInputs().model_dump()),
        is_default=True,
    )
    db.add(default_plan)
    db.commit()

    token = create_access_token(user.id, user.email)
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "display_name": user.display_name},
    )


@app.post("/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Log in with email and password."""
    user = db.query(User).filter(User.email == req.email.lower().strip()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "display_name": user.display_name},
    )


@app.get("/auth/me")
def get_me(user: User = Depends(require_user)):
    """Get current user info."""
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


# ═══════════════════════════════════════════════════════════════
# PLAN CRUD ENDPOINTS
# ═══════════════════════════════════════════════════════════════

class PlanCreateRequest(BaseModel):
    name: str = "My Plan"
    inputs: Optional[dict] = None
    scenarios: Optional[list] = None

class PlanUpdateRequest(BaseModel):
    name: Optional[str] = None
    inputs: Optional[dict] = None
    scenarios: Optional[list] = None
    is_default: Optional[bool] = None

class PlanResponse(BaseModel):
    id: int
    name: str
    inputs: dict
    scenarios: list
    is_default: bool
    created_at: str
    updated_at: str
    share_token: Optional[str] = None


def plan_to_response(plan: Plan) -> dict:
    """Convert a Plan ORM object to API response dict."""
    share = plan.shared_links[0] if plan.shared_links else None
    return {
        "id": plan.id,
        "name": plan.name,
        "inputs": plan.get_inputs(),
        "scenarios": plan.get_scenarios(),
        "is_default": plan.is_default,
        "created_at": plan.created_at.isoformat() if plan.created_at else "",
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else "",
        "share_token": share.token if share else None,
    }


@app.get("/plans")
def list_plans(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """List all plans for the current user."""
    plans = db.query(Plan).filter(Plan.user_id == user.id).order_by(Plan.updated_at.desc()).all()
    return [plan_to_response(p) for p in plans]


@app.post("/plans", response_model=PlanResponse)
def create_plan(req: PlanCreateRequest, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Create a new plan."""
    # Limit to 10 plans per user
    count = db.query(Plan).filter(Plan.user_id == user.id).count()
    if count >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 plans per user")

    inputs = req.inputs or SimulationInputs().model_dump()
    plan = Plan(
        user_id=user.id,
        name=req.name,
        inputs_json=json.dumps(inputs),
        scenarios_json=json.dumps(req.scenarios or []),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan_to_response(plan)


@app.get("/plans/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Get a specific plan."""
    plan = db.query(Plan).filter(Plan.id == plan_id, Plan.user_id == user.id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan_to_response(plan)


@app.put("/plans/{plan_id}", response_model=PlanResponse)
def update_plan(plan_id: int, req: PlanUpdateRequest, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Update a plan's name, inputs, scenarios, or default status."""
    plan = db.query(Plan).filter(Plan.id == plan_id, Plan.user_id == user.id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if req.name is not None:
        plan.name = req.name
    if req.inputs is not None:
        plan.set_inputs(req.inputs)
    if req.scenarios is not None:
        plan.set_scenarios(req.scenarios)
    if req.is_default is not None and req.is_default:
        # Unset other defaults
        db.query(Plan).filter(Plan.user_id == user.id, Plan.is_default == True).update({"is_default": False})
        plan.is_default = True

    db.commit()
    db.refresh(plan)
    return plan_to_response(plan)


@app.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Delete a plan."""
    plan = db.query(Plan).filter(Plan.id == plan_id, Plan.user_id == user.id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Don't delete the last plan
    count = db.query(Plan).filter(Plan.user_id == user.id).count()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete your only plan")

    db.delete(plan)
    db.commit()
    return {"deleted": True, "id": plan_id}


# ═══════════════════════════════════════════════════════════════
# SHARE ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.post("/plans/{plan_id}/share")
def create_share_link(plan_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Generate a shareable read-only link for a plan."""
    plan = db.query(Plan).filter(Plan.id == plan_id, Plan.user_id == user.id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Reuse existing link if one exists
    existing = db.query(SharedLink).filter(SharedLink.plan_id == plan_id).first()
    if existing:
        return {"token": existing.token, "url": f"/shared/{existing.token}"}

    token = secrets.token_urlsafe(32)
    link = SharedLink(plan_id=plan_id, token=token)
    db.add(link)
    db.commit()
    return {"token": token, "url": f"/shared/{token}"}


@app.get("/shared/{token}")
def view_shared_plan(token: str, db: Session = Depends(get_db)):
    """View a shared plan (no auth required). Returns plan data + simulation results."""
    link = db.query(SharedLink).filter(SharedLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Shared plan not found")

    # Increment view counter
    link.views += 1
    db.commit()

    plan = link.plan
    owner = plan.owner

    # Run simulation with plan inputs
    inputs = plan.get_inputs()
    result = run_engine(inputs)

    return {
        "plan_name": plan.name,
        "owner_name": owner.display_name if owner else "Anonymous",
        "inputs": inputs,
        "scenarios": plan.get_scenarios(),
        "simulation": {
            "monthly": result["monthly"],
            "yearly": result["yearly"],
        },
        "views": link.views,
        "shared_at": link.created_at.isoformat() if link.created_at else "",
    }


# ═══════════════════════════════════════════════════════════════
# SIMULATE WITH AUTH (optional — saves results to plan)
# ═══════════════════════════════════════════════════════════════

@app.post("/plans/{plan_id}/simulate")
def simulate_plan(
    plan_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Run simulation using a saved plan's inputs. Optionally saves updated inputs."""
    plan = db.query(Plan).filter(Plan.id == plan_id, Plan.user_id == user.id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    start = time.perf_counter()
    inputs = plan.get_inputs()
    result = run_engine(inputs)
    elapsed_ms = (time.perf_counter() - start) * 1000

    return {
        "monthly": result["monthly"],
        "yearly": result["yearly"],
        "metadata": {
            "plan_id": plan.id,
            "plan_name": plan.name,
            "months": len(result["monthly"]),
            "years": len(result["yearly"]),
            "elapsed_ms": round(elapsed_ms, 1),
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
