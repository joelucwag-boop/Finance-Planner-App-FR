import { BASE, Y } from './constants.js';

// Run the JS delta engine for a set of input overrides
function computeScenarioNW(overrides, userInputs, engineUserPlan) {
  const bl = engineUserPlan || ENGINE_BASELINE_BY_YR; // fallback for initial load
  const base = userInputs || BASE;
  const scenarioInputs = {...base, ...overrides};
  const scenarioEngine = {};
  for (const row of runMonthlyEngine(scenarioInputs).yearly) scenarioEngine[row.yr] = row;
  return Y.map(yb => {
    const eu = bl[yb.yr] || yb;
    const es = scenarioEngine[yb.yr];
    if (!es) return yb.nw;
    return yb.nw + (es.nw - eu.nw);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL MONTHLY SIMULATION ENGINE — v13 FEATURE PARITY
// Runs 523 months. Returns { monthly: [...], yearly: [...] }
// Monthly shape matches _MR: [yr, mo, gross, tax, take, spend, left,
//   sn, sav, unalloc, short, k401, tsp, roth, c529, prim, acorn, brok,
//   slUn, slSub, cab, mort, carLoan, totalDebt, nw, homeVal, events]
// Yearly shape matches Y array fields.
// ═══════════════════════════════════════════════════════════════════════════

// Federal tax brackets (2026 MFJ base, will be inflation-adjusted)
// Safe default: only use fallback for null/undefined, NOT for 0 or ""
const v = (x, d) => x != null ? x : d;

const FED_BRACKETS_MFJ = [
  { limit: 23200, rate: 0.10 },
  { limit: 94300, rate: 0.12 },
  { limit: 201050, rate: 0.22 },
  { limit: 383900, rate: 0.24 },
  { limit: 487450, rate: 0.32 },
  { limit: 731200, rate: 0.35 },
  { limit: Infinity, rate: 0.37 },
];
const FED_BRACKETS_SINGLE = [
  { limit: 11600, rate: 0.10 },
  { limit: 47150, rate: 0.12 },
  { limit: 100525, rate: 0.22 },
  { limit: 191950, rate: 0.24 },
  { limit: 243725, rate: 0.32 },
  { limit: 609350, rate: 0.35 },
  { limit: Infinity, rate: 0.37 },
];

// Guard officer pay table: [yearsService, monthlyBase]
// Simplified from 2026 DoD pay charts (O-1 through O-3E)
const GUARD_PAY = [
  { minYrs: 0, rank: "O-1", monthly: 3826 },  // O-1 base
  { minYrs: 2, rank: "O-1E", monthly: 4700 },  // O-1E (prior enlisted)
  { minYrs: 3, rank: "O-2", monthly: 5200 },
  { minYrs: 6, rank: "O-2E", monthly: 5800 },
  { minYrs: 8, rank: "O-3", monthly: 6500 },
  { minYrs: 12, rank: "O-3E", monthly: 7200 },
  { minYrs: 16, rank: "O-3+", monthly: 7800 },
];

// Wife work schedule lookup per kid age
// Returns multiplier: 0 = none, partTimePct = part, 1 = full
function wifeWorkMult(inp, kidAges) {
  // Default schedule from v13: baby year = none, ages 1-5 = full
  // For simplicity, we check: any kid age 0 → wife doesn't work that month
  // This matches the v13 "none" for baby year, "full" for ages 1+
  const hasNewborn = kidAges.some(a => a === 0);
  if (hasNewborn) return 0; // none = stays home in baby year
  return 1; // full otherwise
}

// Marriage spending multipliers
const MARRIAGE_MULT = {
  groceries: 1.8, dining: 1.5, funMoney: 1.3, clothing: 1.5,
  streaming: 1.2, subscriptions: 1.3, misc: 1.5, gas: 1.3,
  gym: 1.5, phone: 1, internet: 1,
};

// Per-bill inflation rates from v13
const BILL_INFLATION = {
  phone: 0.01, internet: 0.02, streaming: 0.02, subscriptions: 0.02,
  gym: 0.02, groceries: 0.028, gas: 0.03, clothing: 0.025,
  dining: 0.03, funMoney: 0.025, misc: 0.025,
};

// Car purchase schedule: [yearOfWork, price, apr, loanMonths]
function getCarSchedule(inp) {
  return [
    { yr: v(inp.car1Year, 3), price: v(inp.car1Price, 35000), apr: 0.059, months: 60 },
    { yr: v(inp.car2Year, 10), price: v(inp.car2Price, 40000), apr: 0.055, months: 60 },
    { yr: v(inp.car3Year, 17), price: v(inp.car3Price, 45000), apr: 0.05, months: 60 },
    { yr: v(inp.car4Year, 24), price: v(inp.car4Price, 50000), apr: 0.05, months: 60 },
    { yr: v(inp.car5Year, 31), price: v(inp.car5Price, 55000), apr: 0.05, months: 60 },
  ];
}

function runMonthlyEngine(inp) {
  const startYear = v(inp.startYear, 2026);
  const startMonth = v(inp.jobStartMonth, 6); // June
  const birthYear = v(inp.birthYear, 2003);
  const _wedEnabled = v(inp.weddingEnabled, true);
  const weddingCalYear = (_wedEnabled === true || _wedEnabled === "true")
    ? startYear + (v(inp.weddingYear, 2))
    : 9999; // disabled = never married in sim
  const weddingMonth = v(inp.weddingMonth, 10);
  const houseCalYear = startYear + (v(inp.buyYear, 1));
  const housePurchaseMonth = v(inp.housePurchaseMonth, 6);
  const retireAge = v(inp.retireAge, 67);
  // ALWAYS simulate to 2069 to match baseline horizon.
  // Retirement age gates salary income, not the simulation end.
  const fixedEndYear = 2069;

  // Kid birth calendar years
  const kidBirthYears = [];
  const kidYearOffsets = [inp.kid1Year, inp.kid2Year, inp.kid3Year, inp.kid4Year, 15];
  const _kidsOn = v(inp.kidsEnabled, true);
  const _effectiveNumKids = (_kidsOn === true || _kidsOn === "true") ? Math.min(v(inp.numKids, 4), 5) : 0;
  for (let k = 0; k < _effectiveNumKids; k++) {
    kidBirthYears.push(startYear + (kidYearOffsets[k] || (5 + k * 2)));
  }

  // Mortgage pre-computation
  const loanAmt = (v(inp.housePrice, 300000)) * (1 - (v(inp.downPct, 0)));
  const closingCosts = (v(inp.housePrice, 300000)) * (v(inp.closingCostPct, 0.03));
  const mRate = (v(inp.mortRate, 0.06)) / 12;
  const mPayments = (v(inp.mortYears, 15)) * 12;
  const mortPmt = loanAmt > 0 && mRate > 0
    ? loanAmt * mRate * Math.pow(1 + mRate, mPayments) / (Math.pow(1 + mRate, mPayments) - 1)
    : 0;

  // Car schedule
  const cars = getCarSchedule(inp);
  // Active car loans: [{bal, pmt, remaining}]
  let carLoans = [];
  let prevCarPrice = 0;

  // ── RUNNING STATE ──
  let sn = 0, sav = 0, unalloc = 0, shortfall = 0;
  let k401 = v(inp.k401Current, 5633);
  let tsp = v(inp.tspCurrent, 7787);
  let roth = v(inp.rothCurrent, 0);
  let c529 = v(inp.c529Current, 0);
  let prim = v(inp.primCurrent, 1870);
  let acorn = v(inp.acornCurrent, 5551);
  let brok = v(inp.brokCurrent, 0);
  let slUn = v(inp.slUnsubBal, 51800);
  let slSub = v(inp.slSubBal, 22200);
  let cab = v(inp.cabelasBal, 4200);
  let mortBal = 0;
  let homeVal = 0;
  let carLoanBal = 0;

  // Track marriage status
  let married = false;

  const monthly = [];
  const yearly = {};

  // ── PRE-PASS: Compute annual gross income per year for accurate tax brackets ──
  // The Excel computes taxes on actual annual income, not annualized monthly.
  // This pass runs a lightweight income computation to get yearly totals.
  const annualGrossPreCalc = {};
  const annualYourGross = {};
  const annualWifeGross = {};
  const monthsInYear = {};
  for (let yr = startYear; yr <= fixedEndYear; yr++) {
    const moS = (yr === startYear) ? startMonth : 1;
    let yrGross = 0, yrYourGross = 0, yrWifeGross = 0;
    let yrPreTax = 0;
    let moCount = 0;
    for (let mo = moS; mo <= 12; mo++) {
      moCount++;
      const age = yr - birthYear;
      const mWorked = ((yr - startYear) * 12 + (mo - startMonth));
      const yWorked = mWorked / 12;
      // Quick income calc (mirrors the main loop)
      let yPay = 0;
      if (age <= retireAge) {
        const yrOfW = Math.floor(yWorked);
        if (yrOfW < (v(inp.jumpYear, 5))) {
          const b = (v(inp.hourlyRate, 38.46)) * (v(inp.hoursPerWeek, 52)) * ((v(inp.weeksPerYear, 54)) / 12);
          const o = (v(inp.hourlyRate, 38.46)) * (v(inp.otMult, 1.5)) * (v(inp.otHours, 10));
          yPay = (b + o) * Math.pow(1 + (v(inp.raise, 0.03)), yWorked);
        } else {
          yPay = ((v(inp.jumpSalary, 120000)) / 12) * Math.pow(1 + (v(inp.raise, 0.03)), yWorked - (v(inp.jumpYear, 5)));
        }
      }
      let gPay = 0;
      const _guardOn = v(inp.guardEnabled, true);
      if ((_guardOn === true || _guardOn === "true") && age < (v(inp.stopDrillAge, 60))) {
        const tsYrs = (v(inp.priorEnlisted, 6)) + yWorked;
        let bp = GUARD_PAY[0].monthly;
        for (const s of GUARD_PAY) { if (tsYrs >= s.minYrs) bp = s.monthly; }
        const dr = bp / 30;
        gPay = (4 * dr + (15/12) * dr) * Math.pow(1 + (v(inp.milRaise, 0.035)), yWorked);
      }
      let wPay = 0;
      const _partnerOn = v(inp.partnerEnabled, true);
      if ((_partnerOn === true || _partnerOn === "true") && age <= retireAge && (v(inp.wifeStart, 50000)) > 0) {
        const wYrs = yWorked - (v(inp.wifeStartYear, 0));
        if (wYrs >= 0) {
          const wJ = v(inp.wifeJumpYear, 5);
          wPay = wYrs < wJ
            ? ((v(inp.wifeStart, 50000)) / 12) * Math.pow(1 + (v(inp.wifeRaise, 0.03)), wYrs)
            : ((v(inp.wifeJumpSalary, 72000)) / 12) * Math.pow(1 + (v(inp.wifeRaise, 0.03)), wYrs - wJ);
          const kidBirthYrs = kidBirthYears;
          const kidAges = kidBirthYrs.map(by => yr - by + (mo >= 6 ? 0 : -1)).filter(a => a >= 0 && a <= 5);
          if (kidAges.some(a => a === 0)) wPay = 0;
        }
      }
      let pen = 0;
      if (age >= (v(inp.pensionStartAge, 60))) pen = (v(inp.pensionMonthly, 1200)) * Math.pow(1 + (v(inp.inflation, 0.025)), age - (v(inp.pensionStartAge, 60)));
      let ss = 0;
      if (age >= (v(inp.ssAge, 67))) {
        const isMarr = yr > weddingCalYear || (yr === weddingCalYear && mo >= weddingMonth);
        ss = (v(inp.ssMonthly, 3500)) + (isMarr ? (v(inp.wifeSS, 1500)) : 0);
      }
      const mGross = yPay + gPay + wPay + pen + ss;
      yrGross += mGross;
      yrYourGross += yPay + gPay; // track your income separately for FICA
      yrWifeGross += wPay;
      yrPreTax += yPay * (v(inp.k401pct, 0.04));
    }
    annualGrossPreCalc[yr] = yrGross;
    annualYourGross[yr] = yrYourGross;
    annualWifeGross[yr] = yrWifeGross;
    monthsInYear[yr] = moCount;
  }

  // ── MONTH-BY-MONTH LOOP ──
  for (let yr = startYear; yr <= fixedEndYear; yr++) {
    const moStart = (yr === startYear) ? startMonth : 1;
    // Pre-computed annual tax for this year (computed once, divided by months)
    const isMarriedThisYear = yr > weddingCalYear || (yr === weddingCalYear);
    const yrBrackets = isMarriedThisYear ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE;
    const yrInf = Math.pow(1 + (v(inp.inflation, 0.025)), (yr - startYear));
    const yrStdDed = (isMarriedThisYear ? 29200 : 14600) * yrInf;
    const yrSlIntDed = Math.min(2500, (slUn * (v(inp.slUnsubAPR, 0.058)) + slSub * (v(inp.slSubAPR, 0.053))));
    const yrAnnualGross = annualGrossPreCalc[yr] || 0;
    const yrYourIncome = annualYourGross[yr] || 0;
    const yrWifeIncome = annualWifeGross[yr] || 0;
    // Pre-tax: 401k only on YOUR wages, health premiums
    const yrHealthPrem = ((v(inp.healthPremYou, 300)) + (isMarriedThisYear ? (v(inp.healthPremWife, 200)) : 0))
      * Math.pow(1 + (v(inp.healthcareInflation, 0.05)), yr - startYear) * (monthsInYear[yr] || 12);
    const yr401kPretax = yrYourIncome * (v(inp.k401pct, 0.04));
    const yrAnnualPreTax = yr401kPretax + yrHealthPrem;
    // Federal income tax on taxable income
    const yrTaxable = Math.max(0, yrAnnualGross - yrAnnualPreTax - yrStdDed - yrSlIntDed);
    let yrFedTax = 0, yrPrev = 0;
    for (const b of yrBrackets) {
      const adj = b.limit * yrInf;
      if (yrTaxable > yrPrev) yrFedTax += Math.min(yrTaxable - yrPrev, adj - yrPrev) * b.rate;
      yrPrev = adj;
    }
    // State tax (LA)
    const yrLaDed = (isMarriedThisYear ? 25000 : 12500) * yrInf;
    const yrStateTax = Math.max(0, yrAnnualGross - yrLaDed) * (v(inp.stateTax, 0.03));
    // FICA — PER PERSON (SS caps individually, Medicare has no cap)
    const yrSsBase = 168600 * yrInf;
    const yrSsTaxYou = Math.min(yrYourIncome, yrSsBase) * 0.062;
    const yrSsTaxWife = Math.min(yrWifeIncome, yrSsBase) * 0.062;
    const yrMedTaxYou = yrYourIncome * 0.0145;
    const yrMedTaxWife = yrWifeIncome * 0.0145;
    // Additional Medicare surtax on high earners (per person for single, combined for MFJ)
    const medSurtaxThreshold = (isMarriedThisYear ? 250000 : 200000) * yrInf;
    const yrMedSurtax = Math.max(0, yrAnnualGross - medSurtaxThreshold) * 0.009;
    const yrTotalFICA = yrSsTaxYou + yrSsTaxWife + yrMedTaxYou + yrMedTaxWife + yrMedSurtax;
    const yrTotalTax = yrFedTax + yrStateTax + yrTotalFICA;
    const moTax = yrTotalTax / (monthsInYear[yr] || 12);

    for (let mo = moStart; mo <= 12; mo++) {
      const age = yr - birthYear;
      const monthsWorked = monthly.length;
      const yearsWorked = monthsWorked / 12;
      const calMonth = (yr - startYear) * 12 + (mo - startMonth);
      const inf = Math.pow(1 + (v(inp.inflation, 0.025)), yearsWorked);

      // Check marriage
      if (yr > weddingCalYear || (yr === weddingCalYear && mo >= weddingMonth)) married = true;

      // ════ INCOME ════
      // Your salary
      let yourPay = 0;
      if (age <= retireAge) {
        const yrOfWork = Math.floor(yearsWorked);
        if (yrOfWork < (v(inp.jumpYear, 5))) {
          const base = (v(inp.hourlyRate, 38.46)) * (v(inp.hoursPerWeek, 52)) * ((v(inp.weeksPerYear, 54)) / 12);
          const ot = (v(inp.hourlyRate, 38.46)) * (v(inp.otMult, 1.5)) * (v(inp.otHours, 10));
          yourPay = (base + ot) * Math.pow(1 + (v(inp.raise, 0.03)), yearsWorked);
        } else {
          yourPay = ((v(inp.jumpSalary, 120000)) / 12) * Math.pow(1 + (v(inp.raise, 0.03)), yearsWorked - (v(inp.jumpYear, 5)));
        }
      }

      // Guard pay
      let guardPay = 0;
      if (age < (v(inp.stopDrillAge, 60))) {
        const totalServiceYrs = (v(inp.priorEnlisted, 6)) + yearsWorked;
        let basePay = GUARD_PAY[0].monthly;
        for (const step of GUARD_PAY) {
          if (totalServiceYrs >= step.minYrs) basePay = step.monthly;
        }
        // Guard = 48 drills (4/mo ×12) + 15 AT days/yr
        // Monthly: 4 drills × daily rate + 15/12 AT days × daily rate
        const dailyRate = basePay / 30;
        guardPay = (4 * dailyRate + (15 / 12) * dailyRate) * Math.pow(1 + (v(inp.milRaise, 0.035)), yearsWorked);
      }

      // Wife pay
      let wifePay = 0;
      if (age <= retireAge && (v(inp.wifeStart, 50000)) > 0) {
        const wifeYrsWorked = yearsWorked - (v(inp.wifeStartYear, 0));
        if (wifeYrsWorked >= 0) {
          const wifeJump = v(inp.wifeJumpYear, 5);
          if (wifeYrsWorked < wifeJump) {
            wifePay = ((v(inp.wifeStart, 50000)) / 12) * Math.pow(1 + (v(inp.wifeRaise, 0.03)), wifeYrsWorked);
          } else {
            wifePay = ((v(inp.wifeJumpSalary, 72000)) / 12) * Math.pow(1 + (v(inp.wifeRaise, 0.03)), wifeYrsWorked - wifeJump);
          }
          // Reduce for kid schedule
          const kidAges = kidBirthYears.map(by => yr - by + (mo >= 6 ? 0 : -1)).filter(a => a >= 0 && a <= 5);
          const mult = wifeWorkMult(inp, kidAges);
          if (mult === 0) wifePay = 0;
          else if (mult < 1) wifePay *= (v(inp.partTimePct, 0.65));
        }
      }

      // Pension
      let pension = 0;
      if (age >= (v(inp.pensionStartAge, 60))) {
        pension = (v(inp.pensionMonthly, 1200)) * Math.pow(1 + (v(inp.inflation, 0.025)), age - (v(inp.pensionStartAge, 60)));
      }

      // Social Security
      let ssBenefit = 0;
      if (age >= (v(inp.ssAge, 67))) {
        ssBenefit = (v(inp.ssMonthly, 3500)) + (married ? (v(inp.wifeSS, 1500)) : 0);
      }

      const grossMonthly = yourPay + guardPay + wifePay + pension + ssBenefit;

      // ════ PRE-TAX DEDUCTIONS ════
      const k401Contrib = yourPay * (v(inp.k401pct, 0.04));
      const k401Match = yourPay * Math.min(v(inp.matchPct, 0.04), v(inp.k401pct, 0.04));
      const healthPrem = ((v(inp.healthPremYou, 300)) + (married ? (v(inp.healthPremWife, 200)) : 0))
        * Math.pow(1 + (v(inp.healthcareInflation, 0.05)), yearsWorked);
      const preTax = k401Contrib + healthPrem;

      // ════ TAXES — using pre-computed annual rate for this year ════
      // Tax was computed in the pre-pass on actual annual income (not annualized monthly).
      // moTax is already computed above as yrTotalTax / monthsInYear[yr].
      const monthlyTax = moTax;
      const takeHome = grossMonthly - preTax - monthlyTax;

      // ════ SPENDING ════
      let housingSpend = 0, healthSpend = 0, kidSpend = 0, carSpend = 0;
      let billSpend = 0, debtSpend = 0, investSpend = 0, oneTimeSpend = 0;

      // Housing
      const boughtHouse = yr > houseCalYear || (yr === houseCalYear && mo >= housePurchaseMonth);
      if (boughtHouse) {
        if (yr === houseCalYear && mo === housePurchaseMonth) {
          mortBal = loanAmt;
          homeVal = v(inp.housePrice, 300000);
          oneTimeSpend += closingCosts + (v(inp.furnishBudget, 15000)) + (v(inp.movingExpense, 3000));
        }
        // Mortgage P&I
        if (mortBal > 0) {
          const intPortion = mortBal * mRate;
          const princPortion = Math.min(mortPmt - intPortion, mortBal);
          mortBal = Math.max(0, mortBal - princPortion);
          housingSpend += mortPmt;
        }
        // Property tax + insurance + maintenance + capital reserve + furniture replacement
        housingSpend += homeVal * (v(inp.propTax, 0.005)) / 12;
        housingSpend += (v(inp.homeIns, 2400)) * inf / 12;
        housingSpend += homeVal * (v(inp.maintenance, 0.005)) / 12;
        housingSpend += homeVal * (v(inp.capitalReserve, 0.005)) / 12;
        housingSpend += (v(inp.furnitureReplace, 1500)) * inf / 12;
        // PMI
        if (homeVal > 0 && (homeVal - mortBal) / homeVal < (v(inp.pmiThreshold, 0.2))) {
          housingSpend += loanAmt * (v(inp.pmi, 0.007)) / 12;
        }
        // Appreciate home
        homeVal *= (1 + (v(inp.appreciation, 0.035)) / 12);
      } else {
        housingSpend = (v(inp.rent, 1400)) * Math.pow(1 + (v(inp.rentIncrease, 0.03)), yearsWorked);
      }

      // Health
      // Already counted premium in pre-tax. Add OOP, dental, pregnancy.
      const numPeople = 1 + (married ? 1 : 0) + kidBirthYears.filter(by => yr > by || (yr === by && mo >= 6)).length;
      healthSpend += (v(inp.annualOOP, 1500)) * numPeople / 12 * Math.pow(1 + (v(inp.healthcareInflation, 0.05)), yearsWorked);
      healthSpend += (v(inp.dentalVision, 50)) * (married ? 2 : 1) * inf;
      // Pregnancy costs
      for (const by of kidBirthYears) {
        const moUntilBirth = (by - yr) * 12 + (6 - mo); // assume June birth
        if (moUntilBirth > 0 && moUntilBirth <= 9) healthSpend += (v(inp.prenatalMonthly, 350));
        if (moUntilBirth >= -6 && moUntilBirth <= 0) healthSpend += (v(inp.postpartumMonthly, 200));
        if (yr === by && mo === 6) oneTimeSpend += (v(inp.birthCost, 5000)); // delivery cost
      }

      // Kids
      for (const by of kidBirthYears) {
        const kidAge = yr - by + (mo >= 6 ? 0 : -1);
        if (kidAge < 0 || kidAge > 22) continue;
        const kidInf = Math.pow(1 + (v(inp.kidInflation, 0.028)), kidAge);
        const dayInf = Math.pow(1 + (v(inp.daycareInflation, 0.045)), kidAge);
        if (kidAge <= 5) {
          kidSpend += ((v(inp.kidCostExDaycare, 3000)) * kidInf + (kidAge <= 4 ? (v(inp.daycare, 15000)) * dayInf : 0)) / 12;
        } else if (kidAge <= 12) {
          kidSpend += (v(inp.kidCost612, 15000)) * kidInf / 12;
        } else if (kidAge <= 17) {
          kidSpend += (v(inp.kidCost1317, 15000)) * kidInf / 12;
        } else if (kidAge <= 21) {
          kidSpend += (v(inp.college, 20000)) * Math.pow(1 + (v(inp.collegeInflation, 0.05)), kidAge - 18) / 12;
        }
      }

      // Cars
      const yrOfWork = Math.floor(yearsWorked);
      for (const car of cars) {
        if (yrOfWork === car.yr && mo === 6) { // buy in June of that work year
          const tradeIn = prevCarPrice * (v(inp.tradeInPct, 0.35));
          const salesTax = car.price * (v(inp.carSalesTaxPct, 0.09));
          const downPmt = car.price * 0.1;
          const financed = car.price + salesTax - downPmt - tradeIn;
          const carMR = car.apr / 12;
          const carPmt = financed > 0 && carMR > 0
            ? financed * carMR * Math.pow(1 + carMR, car.months) / (Math.pow(1 + carMR, car.months) - 1)
            : 0;
          carLoans.push({ bal: financed, pmt: carPmt, remaining: car.months });
          oneTimeSpend += downPmt;
          prevCarPrice = car.price;
        }
      }
      // Car loan payments
      carLoanBal = 0;
      for (let cl = carLoans.length - 1; cl >= 0; cl--) {
        const loan = carLoans[cl];
        if (loan.bal > 0 && loan.remaining > 0) {
          const intPortion = loan.bal * 0.07 / 12; // use generic rate
          const princPortion = Math.min(loan.pmt - intPortion, loan.bal);
          loan.bal = Math.max(0, loan.bal - princPortion);
          loan.remaining--;
          carSpend += loan.pmt;
        }
        carLoanBal += Math.max(0, loan.bal);
      }
      // Car insurance + maintenance + registration
      carSpend += (v(inp.carIns, 350)) * Math.pow(1 + (v(inp.carInsIncrease, 0.03)), yearsWorked);
      carSpend += (v(inp.carMaintenance, 1200)) * inf / 12;
      carSpend += (v(inp.carRegistration, 200)) * inf / 12;

      // Bills (11 categories with per-bill inflation and marriage multipliers)
      const billKeys = ["phone", "internet", "streaming", "subscriptions", "gym",
        "groceries", "gas", "clothing", "dining", "funMoney", "misc"];
      for (const bk of billKeys) {
        const base = inp[bk] || 0;
        const billInf = Math.pow(1 + (BILL_INFLATION[bk] || 0.025), yearsWorked);
        const marriageMult = married ? (MARRIAGE_MULT[bk] || 1) : 1;
        billSpend += base * billInf * marriageMult;
      }

      // Insurance
      const lifeInsPrem = (age <= (v(inp.lifeInsStartYear, 2026)) + (v(inp.lifeInsTerm, 20)) - birthYear)
        ? (v(inp.lifeInsPremium, 35)) : 0;
      const disabilityPrem = (v(inp.disabilityPremium, 50));
      const umbrellaPrem = (v(inp.umbrellaAnnual, 300)) / 12;
      const insCost = lifeInsPrem + disabilityPrem + umbrellaPrem;

      // Other costs: vacation, gifts, personal care, pets
      const vacationMo = (v(inp.vacationAnnual, 3000)) * Math.pow(1 + (v(inp.vacationInflation, 0.03)), yearsWorked) / 12;
      const giftMo = (v(inp.giftAnnual, 2000)) * Math.pow(1 + (v(inp.giftInflation, 0.025)), yearsWorked) * (married ? (v(inp.giftMarriageMult, 1.5)) : 1) / 12;
      const personalCareMo = (v(inp.personalCare, 150)) * Math.pow(1 + (v(inp.personalCareInflation, 0.025)), yearsWorked) * (married ? (v(inp.personalCareMarriageMult, 1.8)) : 1);
      const petMo = (v(inp.petMonthly, 250)) * Math.pow(1 + (v(inp.petInflation, 0.04)), yearsWorked);
      const otherSpend = vacationMo + giftMo + personalCareMo + petMo + insCost;

      // Debts (avalanche: highest APR first — monthly amortization)
      if (cab > 0) {
        const cabInt = cab * (v(inp.cabelasAPR, 0.18)) / 12;
        const cabPay = Math.min((v(inp.cabelasPmt, 200)), cab + cabInt);
        cab = Math.max(0, cab + cabInt - cabPay);
        debtSpend += cabPay;
      }
      if (slUn > 0) {
        const slUnInt = slUn * (v(inp.slUnsubAPR, 0.058)) / 12;
        const slUnPay = Math.min((v(inp.slUnsubPmt, 570)), slUn + slUnInt);
        slUn = Math.max(0, slUn + slUnInt - slUnPay);
        debtSpend += slUnPay;
      }
      if (slSub > 0) {
        const slSubInt = slSub * (v(inp.slSubAPR, 0.053)) / 12;
        const slSubPay = Math.min((v(inp.slSubPmt, 239)), slSub + slSubInt);
        slSub = Math.max(0, slSub + slSubInt - slSubPay);
        debtSpend += slSubPay;
      }

      // Wedding
      if (yr === weddingCalYear && mo === weddingMonth) {
        oneTimeSpend += (v(inp.weddingCost, 50000));
      }

      // After-tax investment contributions
      const tspContrib = (v(inp.tspMonthly, 200));
      const rothContrib = (v(inp.rothMonthly, 25));
      const primContrib = (v(inp.primMonthly, 25));
      const acornContrib = (v(inp.acornMonthly, 80));
      const activeKids529 = kidBirthYears.filter(by => yr >= by && yr < by + 22).length;
      const c529Contrib = (v(inp.c529Monthly, 100)) * activeKids529;
      investSpend = tspContrib + rothContrib + primContrib + acornContrib + c529Contrib;

      // ════ TOTAL SPENDING ════
      const totalSpend = housingSpend + healthSpend + kidSpend + carSpend
        + billSpend + debtSpend + investSpend + otherSpend + oneTimeSpend;

      // ════ LEFTOVER ════
      const leftover = takeHome - totalSpend;

      // ════ SAVINGS WATERFALL ════
      const monthlyExpenses = (housingSpend + healthSpend + kidSpend + billSpend + otherSpend);
      const snTarget = monthlyExpenses * (v(inp.snTarget, 8));

      if (leftover >= 0) {
        // Pay down shortfall first
        let remaining = leftover;
        if (shortfall > 0) {
          const sfPay = Math.min(remaining, shortfall);
          shortfall -= sfPay;
          remaining -= sfPay;
        }
        // Safety net fill
        const snNeed = Math.max(0, snTarget - sn);
        const toSN = Math.min(remaining * (v(inp.snPct, 0.3)), snNeed);
        sn += toSN; remaining -= toSN;
        // Redirect unfilled SN portion to savings
        const snRemainder = remaining * (v(inp.snPct, 0.3)) - toSN; // leftover SN allocation
        // General savings
        const toSav = remaining * (v(inp.savPct, 0.5)) + (snNeed <= 0 ? remaining * (v(inp.snPct, 0.3)) : Math.max(0, snRemainder));
        sav += toSav; remaining -= toSav;
        // Unallocated
        const toUnalloc = remaining;
        unalloc += toUnalloc;
        // Auto-invest overflow
        const overflowThreshold = v(inp.autoInvestThreshold, 10000);
        if (unalloc > overflowThreshold) {
          const overflow = unalloc - overflowThreshold;
          brok += overflow;
          unalloc = overflowThreshold;
        }
      } else {
        // Negative leftover: draw from accounts
        let deficit = Math.abs(leftover);
        // Draw from unallocated first
        const fromUnalloc = Math.min(deficit, unalloc);
        unalloc -= fromUnalloc; deficit -= fromUnalloc;
        // Then savings
        const fromSav = Math.min(deficit, sav);
        sav -= fromSav; deficit -= fromSav;
        // Then safety net
        const fromSN = Math.min(deficit, sn);
        sn -= fromSN; deficit -= fromSN;
        // Remaining = shortfall borrowing
        if (deficit > 0) {
          shortfall += deficit;
        }
      }

      // Shortfall interest
      if (shortfall > 0) {
        shortfall *= (1 + (v(inp.shortfallRate, 0.12)) / 12);
      }

      // ════ INVESTMENT GROWTH ════
      const monthlyInvReturn = (v(inp.invReturn, 0.07)) / 12;
      k401 = (k401 + k401Contrib + k401Match) * (1 + monthlyInvReturn);
      tsp = (tsp + tspContrib) * (1 + monthlyInvReturn);
      roth = (roth + rothContrib) * (1 + monthlyInvReturn);
      c529 = (c529 + c529Contrib) * (1 + (v(inp.c529Return, 0.07)) / 12);
      prim = (prim + primContrib) * (1 + monthlyInvReturn);
      acorn = (acorn + acornContrib) * (1 + monthlyInvReturn);
      // Brokerage: growth - expense ratio + dividends
      const brokGrowth = (v(inp.brokerageReturn, 0.07)) - (v(inp.brokExpenseRatio, 0.0004));
      const divs = brok * (v(inp.divYield, 0.02)) / 12;
      if (inp.divHandling === "cash") {
        sav += divs * (1 - (v(inp.divTaxRate, 0.18))); // after-tax dividends to savings
        brok *= (1 + brokGrowth / 12);
      } else {
        brok = (brok + divs) * (1 + brokGrowth / 12); // DRIP
      }

      // Savings/SN interest
      sn *= (1 + (v(inp.savingsAPY, 0.045)) / 12);
      sav *= (1 + (v(inp.savingsAPY, 0.045)) / 12);

      // ════ NET WORTH ════
      const totalDebt = slUn + slSub + cab + mortBal + carLoanBal + shortfall;
      const totalInvested = k401 + tsp + roth + c529 + prim + acorn + brok;
      const totalCash = sn + sav + unalloc;
      const homeEquity = Math.max(0, homeVal - mortBal);
      const nw = totalCash + totalInvested + homeEquity - slUn - slSub - cab - carLoanBal - shortfall;

      // ════ PUSH MONTHLY ROW ════
      // Match the _MR format: [yr, mo, gross, tax, take, spend, left,
      //   sn, sav, unalloc, short, k401, tsp, roth, c529, prim, acorn, brok,
      //   slUn, slSub, cab, mort, carLoan, totalDebt, nw, homeVal, events]
      monthly.push([
        yr, mo,
        Math.round(grossMonthly), Math.round(monthlyTax), Math.round(takeHome),
        Math.round(totalSpend), Math.round(leftover),
        Math.round(sn), Math.round(sav), Math.round(unalloc), Math.round(shortfall),
        Math.round(k401), Math.round(tsp), Math.round(roth), Math.round(c529),
        Math.round(prim), Math.round(acorn), Math.round(brok),
        Math.round(slUn), Math.round(slSub), Math.round(cab),
        Math.round(mortBal), Math.round(carLoanBal),
        Math.round(totalDebt), Math.round(nw), Math.round(homeVal),
        Math.round(oneTimeSpend > 0 ? oneTimeSpend : 0)
      ]);

      // ════ YEARLY ACCUMULATOR ════
      if (!yearly[yr]) {
        yearly[yr] = { gross: 0, tax: 0, take: 0, spend: 0, left: 0 };
      }
      yearly[yr].gross += grossMonthly;
      yearly[yr].tax += monthlyTax;
      yearly[yr].take += takeHome;
      yearly[yr].spend += totalSpend;
      yearly[yr].left += leftover;
      // End-of-December snapshot (or last month of year)
      if (mo === 12 || (yr === fixedEndYear && mo === 12)) {
        yearly[yr].sn = sn; yearly[yr].sav = sav;
        yearly[yr].inv = totalInvested; yearly[yr].debt = totalDebt;
        yearly[yr].nw = nw; yearly[yr].home = homeVal; yearly[yr].mort = mortBal;
        yearly[yr].k401 = k401; yearly[yr].tsp = tsp; yearly[yr].roth = roth;
        yearly[yr].brok = brok; yearly[yr].c529 = c529;
      }
    }
  }

  // Convert yearly accumulator to array matching Y shape
  const yearlyArr = Object.entries(yearly)
    .filter(([_, v]) => v.nw !== undefined) // only complete years
    .map(([yr, v]) => ({
      yr: Number(yr),
      gross: Math.round(v.gross), tax: Math.round(v.tax),
      take: Math.round(v.take), spend: Math.round(v.spend),
      left: Math.round(v.left), nw: Math.round(v.nw),
      debt: Math.round(v.debt), sn: Math.round(v.sn), sav: Math.round(v.sav),
      inv: Math.round(v.inv), home: Math.round(v.home), mort: Math.round(v.mort),
      k401: Math.round(v.k401), tsp: Math.round(v.tsp),
      roth: Math.round(v.roth), brok: Math.round(v.brok),
      c529: Math.round(v.c529 || 0),
    }));

  return { monthly, yearly: yearlyArr };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-COMPUTED ENGINE BASELINE — runs once on file load, not on tab switch.
// This is the single biggest performance fix: avoids re-running the 553-line
// engine function every time the What-If tab is opened.
// ═══════════════════════════════════════════════════════════════════════════
const _ENGINE_BASELINE_RESULT = runMonthlyEngine(BASE);
const ENGINE_BASELINE_BY_YR = {};
for (const row of _ENGINE_BASELINE_RESULT.yearly) ENGINE_BASELINE_BY_YR[row.yr] = row;

export { runMonthlyEngine, computeScenarioNW, v, GUARD_PAY, MARRIAGE_MULT, BILL_INFLATION, getCarSchedule, FED_BRACKETS_MFJ, FED_BRACKETS_SINGLE, wifeWorkMult, ENGINE_BASELINE_BY_YR };