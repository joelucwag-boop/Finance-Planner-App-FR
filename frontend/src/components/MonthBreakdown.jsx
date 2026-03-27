import { useState, useMemo } from 'react';
import { C, BASE, M, fmt, fmtFull, moName } from '../constants.js';
import { GUARD_PAY, MARRIAGE_MULT, BILL_INFLATION } from '../engine.js';

// Compute detailed income/expense breakdown for a single month
function getMonthBreakdown(yr, mo) {
  const inp = BASE;
  const startYear = BASE.startYear||2026, startMonth = BASE.jobStartMonth||6, birthYear = BASE.birthYear||2003;
  const age = yr - birthYear;
  const monthsWorked = (yr - startYear) * 12 + (mo - startMonth);
  if (monthsWorked < 0) return null; // before career starts
  const yearsWorked = monthsWorked / 12;
  const inf = Math.pow(1 + 0.025, yearsWorked);
  const weddingCalYear = startYear + 2, weddingMonth = 10;
  const married = yr > weddingCalYear || (yr === weddingCalYear && mo >= weddingMonth);
  const houseCalYear = startYear + 1, housePurchaseMonth = 6;
  const boughtHouse = yr > houseCalYear || (yr === houseCalYear && mo >= housePurchaseMonth);
  const retireAge = inp.retireAge;
  const kidBirthYears = [2031, 2033, 2035, 2037].slice(0, inp.numKids); // approx from v13 defaults

  // ── INCOME ──
  const income = [];
  // Your pay
  let yourPay = 0;
  if (age <= retireAge) {
    const yrOfWork = Math.floor(yearsWorked);
    if (yrOfWork < inp.jumpYear) {
      const base = inp.hourlyRate * inp.hoursPerWeek * (inp.weeksPerYear / 12);
      const ot = inp.hourlyRate * inp.otMult * inp.otHours;
      yourPay = (base + ot) * Math.pow(1 + inp.raise, yearsWorked);
    } else {
      yourPay = (inp.jumpSalary / 12) * Math.pow(1 + inp.raise, yearsWorked - inp.jumpYear);
    }
  }
  if (yourPay > 0) income.push({label:"Your Salary", amount:yourPay, color:"#3b82f6"});

  // Guard pay
  let guardPay = 0;
  if (age < inp.stopDrillAge) {
    const tsYrs = inp.priorEnlisted + yearsWorked;
    let bp = GUARD_PAY[0].monthly;
    for (const s of GUARD_PAY) { if (tsYrs >= s.minYrs) bp = s.monthly; }
    guardPay = (4 * bp/30 + (15/12) * bp/30) * Math.pow(1 + inp.milRaise, yearsWorked);
  }
  if (guardPay > 0) income.push({label:"Guard Pay", amount:guardPay, color:"#22c55e"});

  // Wife pay
  let wifePay = 0;
  if (age <= retireAge && inp.wifeStart > 0) {
    const wYrs = yearsWorked;
    if (wYrs >= 0) {
      wifePay = wYrs < inp.wifeJumpYear
        ? (inp.wifeStart / 12) * Math.pow(1 + inp.wifeRaise, wYrs)
        : (inp.wifeJumpSalary / 12) * Math.pow(1 + inp.wifeRaise, wYrs - inp.wifeJumpYear);
      const kidAges = kidBirthYears.map(by => yr - by).filter(a => a >= 0 && a <= 5);
      if (kidAges.some(a => a === 0)) wifePay = 0;
    }
  }
  if (wifePay > 0) income.push({label:(BASE.partnerName||"Partner")+" Salary", amount:wifePay, color:"#a78bfa"});

  // Pension
  let pension = 0;
  if (age >= inp.pensionStartAge) {
    pension = inp.pensionMonthly * Math.pow(1 + 0.025, age - inp.pensionStartAge);
    income.push({label:"Guard Pension", amount:pension, color:"#f59e0b"});
  }

  // Social Security
  let ssBenefit = 0;
  if (age >= inp.ssAge) {
    ssBenefit = inp.ssMonthly + (married ? inp.wifeSS : 0);
    income.push({label:"Social Security", amount:ssBenefit, color:"#06b6d4"});
  }

  const grossIncome = income.reduce((s,i) => s + i.amount, 0);

  // ── TAXES (approximate monthly) ──
  // Get from baked M data for accuracy
  const mRow = M.find(r => r.yr === yr && r.mo === mo);
  const tax = mRow ? mRow.tax : grossIncome * 0.25;

  // ── EXPENSES ──
  const expenses = [];

  // Housing
  if (boughtHouse) {
    const housePrice = inp.housePrice;
    const loanAmt = housePrice * (1 - inp.downPct);
    const mRate = inp.mortRate / 12;
    const mPmts = inp.mortYears * 12;
    const mortPmt = loanAmt > 0 && mRate > 0
      ? loanAmt * mRate * Math.pow(1+mRate,mPmts) / (Math.pow(1+mRate,mPmts)-1) : 0;
    const homeVal = housePrice * Math.pow(1 + inp.appreciation, yearsWorked);
    // Check if mortgage is paid off
    const monthsSinceBuy = (yr - houseCalYear)*12 + (mo - housePurchaseMonth);
    if (monthsSinceBuy < mPmts && mortPmt > 0)
      expenses.push({label:"Mortgage (P&I)", amount:mortPmt, color:"#ef4444"});
    expenses.push({label:"Property Tax", amount:homeVal * inp.propTax / 12, color:"#f97316"});
    expenses.push({label:"Home Insurance", amount:inp.homeIns * inf / 12, color:"#f97316"});
    expenses.push({label:"Maintenance", amount:homeVal * inp.maintenance / 12, color:"#f97316"});
  } else {
    const rentAmt = inp.rent * Math.pow(1 + inp.rentIncrease, yearsWorked);
    expenses.push({label:"Rent", amount:rentAmt, color:"#ef4444"});
  }

  // Health
  const hPrem = (inp.healthPremYou + (married ? inp.healthPremWife : 0))
    * Math.pow(1 + inp.healthcareInflation, yearsWorked);
  expenses.push({label:"Health Insurance", amount:hPrem, color:"#ec4899"});
  const numPeople = 1 + (married?1:0) + kidBirthYears.filter(by => yr >= by).length;
  const oop = inp.annualOOP * numPeople / 12 * Math.pow(1 + inp.healthcareInflation, yearsWorked);
  if (oop > 10) expenses.push({label:"Medical OOP", amount:oop, color:"#ec4899"});

  // Bills
  const billKeys = ["groceries","dining","funMoney","gas","phone","internet",
    "streaming","subscriptions","gym","clothing","misc"];
  const billLabels = {groceries:"Groceries",dining:"Dining Out",funMoney:"Fun Money",
    gas:"Gas/Fuel",phone:"Phone",internet:"Internet",streaming:"Streaming",
    subscriptions:"Subscriptions",gym:"Gym",clothing:"Clothing",misc:"Misc"};
  for (const bk of billKeys) {
    const base = inp[bk] || 0;
    if (base === 0) continue;
    const billInf = Math.pow(1 + (BILL_INFLATION[bk] || 0.025), yearsWorked);
    const marriageMult = married ? (MARRIAGE_MULT[bk] || 1) : 1;
    const amt = base * billInf * marriageMult;
    expenses.push({label:billLabels[bk]||bk, amount:amt, color:"#64748b"});
  }

  // Car costs
  const carIns = inp.carIns * Math.pow(1 + inp.carInsIncrease, yearsWorked);
  expenses.push({label:"Car Insurance", amount:carIns, color:"#f59e0b"});
  expenses.push({label:"Car Maintenance", amount:inp.carMaintenance * inf / 12, color:"#f59e0b"});

  // Debts (approx — check if still active from baked M)
  if (mRow) {
    if (mRow.cab > 0 || (mo <= 12 && yr <= 2027)) expenses.push({label:"Credit Card", amount:inp.cabelasPmt, color:"#ef4444"});
    if (mRow.slU > 0) expenses.push({label:"SL Unsubsidized", amount:inp.slUnsubPmt, color:"#ef4444"});
    if (mRow.slS > 0) expenses.push({label:"SL Subsidized", amount:inp.slSubPmt, color:"#ef4444"});
    if (mRow.mort > 0) {} // already counted above
    if (mRow.carLn > 0) expenses.push({label:"Car Loan", amount:400, color:"#ef4444"}); // approx
  }

  // Investments (contributions from take-home)
  const k401c = yourPay * inp.k401pct;
  if (k401c > 0) expenses.push({label:"401(k) Contribution", amount:k401c, color:"#3b82f6"});
  if (inp.tspMonthly > 0) expenses.push({label:"TSP Contribution", amount:inp.tspMonthly, color:"#3b82f6"});
  if (inp.rothMonthly > 0) expenses.push({label:"Roth IRA", amount:inp.rothMonthly, color:"#3b82f6"});

  // Kids
  let totalKidCost = 0;
  for (const by of kidBirthYears) {
    const kidAge = yr - by;
    if (kidAge < 0 || kidAge > 22) continue;
    const kidInf = Math.pow(1 + inp.kidInflation, kidAge);
    if (kidAge <= 5) totalKidCost += (inp.kidCostExDaycare * kidInf + (kidAge <= 4 ? inp.daycare * Math.pow(1+inp.daycareInflation,kidAge) : 0)) / 12;
    else if (kidAge <= 12) totalKidCost += inp.kidCost612 * kidInf / 12;
    else if (kidAge <= 17) totalKidCost += inp.kidCost1317 * kidInf / 12;
    else if (kidAge <= 21) totalKidCost += inp.college * Math.pow(1+inp.collegeInflation,kidAge-18) / 12;
  }
  if (totalKidCost > 0) expenses.push({label:"Kids", amount:totalKidCost, color:"#a78bfa"});

  // Other
  const vacation = inp.vacationAnnual * Math.pow(1+inp.vacationInflation, yearsWorked) / 12;
  const gifts = inp.giftAnnual * Math.pow(1+inp.giftInflation, yearsWorked) * (married?inp.giftMarriageMult:1) / 12;
  const pet = inp.petMonthly * Math.pow(1+inp.petInflation, yearsWorked);
  if (vacation > 10) expenses.push({label:"Vacation", amount:vacation, color:"#06b6d4"});
  if (gifts > 10) expenses.push({label:"Gifts", amount:gifts, color:"#06b6d4"});
  if (pet > 10) expenses.push({label:"Pets", amount:pet, color:"#06b6d4"});

  // Insurance
  const insurance = inp.lifeInsPremium + inp.disabilityPremium + inp.umbrellaAnnual/12;
  if (insurance > 0) expenses.push({label:"Insurance", amount:insurance, color:"#64748b"});

  const totalExpenses = expenses.reduce((s,e) => s + e.amount, 0);
  const takeHome = grossIncome - tax;
  const netFlow = takeHome - totalExpenses;

  return {
    yr, mo, age, married, boughtHouse, yearsWorked,
    income, grossIncome, tax, takeHome,
    expenses: expenses.sort((a,b) => b.amount - a.amount), // largest first
    totalExpenses, netFlow,
  };
}

// ── MonthBreakdown Component ──
const MonthBreakdown = () => {
  const [selYr, setSelYr] = useState(2027);
  const [selMo, setSelMo] = useState(6);
  const breakdown = useMemo(() => getMonthBreakdown(selYr, selMo), [selYr, selMo]);

  if (!breakdown) return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:20,textAlign:"center",color:C.textDim}}>
      No data for {selYr}-{String(selMo).padStart(2,'0')} (career hasn't started yet)
    </div>
  );

  const {income, grossIncome, tax, takeHome, expenses, totalExpenses, netFlow, age, married} = breakdown;
  const maxBar = Math.max(...income.map(i=>i.amount), ...expenses.map(e=>e.amount), 1);
  const moNames = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Find the month row in baked M for actual NW
  const mRow = M.find(r => r.yr === selYr && r.mo === selMo);

  return (
    <div>
      {/* Month selector */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"12px 16px",marginBottom:14}}>
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <label style={{fontSize:10,color:C.textDim,display:"block",marginBottom:2}}>Year</label>
            <input type="range" min={BASE.startYear||2026} max={(BASE.startYear||2026)+43} value={selYr} onChange={e=>setSelYr(+e.target.value)}
              style={{width:180,height:4,WebkitAppearance:"none",appearance:"none",
                background:`linear-gradient(90deg,${C.blue} ${((selYr-(BASE.startYear||2026))/43)*100}%,${C.border} ${((selYr-(BASE.startYear||2026))/43)*100}%)`,
                borderRadius:2,outline:"none",cursor:"pointer"}} />
          </div>
          <span style={{fontSize:20,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:C.text}}>
            {moNames[selMo]} {selYr}
          </span>
          <div>
            <label style={{fontSize:10,color:C.textDim,display:"block",marginBottom:2}}>Month</label>
            <div style={{display:"flex",gap:2}}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <button key={m} onClick={()=>setSelMo(m)} style={{
                  width:22,height:22,borderRadius:4,border:"none",cursor:"pointer",fontSize:9,fontWeight:600,
                  background:selMo===m?C.blue:C.bg, color:selMo===m?"#fff":C.textDim,
                }}>{m}</button>
              ))}
            </div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontSize:10,color:C.textDim}}>Age {age} · {married?"Married":"Single"}</div>
            {mRow && <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:C.green}}>NW: {fmtFull(mRow.nw)}</div>}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:100}}>
          <div style={{fontSize:10,color:C.textDim}}>Gross Income</div>
          <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:C.green}}>{fmtFull(grossIncome)}</div>
        </div>
        <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:100}}>
          <div style={{fontSize:10,color:C.textDim}}>Taxes</div>
          <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:C.red}}>-{fmtFull(tax)}</div>
        </div>
        <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:100}}>
          <div style={{fontSize:10,color:C.textDim}}>Take-Home</div>
          <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:C.blue}}>{fmtFull(takeHome)}</div>
        </div>
        <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:100}}>
          <div style={{fontSize:10,color:C.textDim}}>Total Spending</div>
          <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:C.red}}>-{fmtFull(totalExpenses)}</div>
        </div>
        <div style={{flex:1,background:`${netFlow>=0?C.green:C.red}15`,border:`1px solid ${netFlow>=0?C.green:C.red}33`,borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:100}}>
          <div style={{fontSize:10,color:C.textDim}}>Net Flow</div>
          <div style={{fontSize:16,fontWeight:800,fontFamily:"monospace",color:netFlow>=0?C.green:C.red}}>
            {netFlow>=0?"+":""}{fmtFull(netFlow)}
          </div>
        </div>
      </div>

      {/* Timeline view — income above the line, expenses below */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",overflow:"hidden"}}>
        {/* INCOME — above the line */}
        <h3 style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:C.green}}>
          INCOME — {fmtFull(grossIncome)}/mo
        </h3>
        <div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:14}}>
          {income.map((item,i) => (
            <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.textMid,width:120,textAlign:"right",flexShrink:0}}>{item.label}</span>
              <div style={{flex:1,height:20,background:C.bg,borderRadius:4,overflow:"hidden",position:"relative"}}>
                <div style={{
                  width:`${Math.max(1,(item.amount/maxBar)*100)}%`,height:"100%",
                  background:`${item.color}55`,borderRadius:4,
                  borderRight:`2px solid ${item.color}`,
                  transition:"width 0.3s",
                }} />
              </div>
              <span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:item.color,width:75,textAlign:"right",flexShrink:0}}>
                {fmtFull(item.amount)}
              </span>
            </div>
          ))}
        </div>

        {/* Center line */}
        <div style={{height:2,background:`linear-gradient(90deg,transparent,${C.border},transparent)`,margin:"4px 0 14px"}} />

        {/* Tax deduction */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,opacity:0.7}}>
          <span style={{fontSize:11,color:C.textMid,width:120,textAlign:"right",flexShrink:0}}>Federal + State + FICA</span>
          <div style={{flex:1,height:16,background:C.bg,borderRadius:4,overflow:"hidden"}}>
            <div style={{width:`${Math.max(1,(tax/maxBar)*100)}%`,height:"100%",
              background:"#ef444455",borderRadius:4,borderRight:"2px solid #ef4444"}} />
          </div>
          <span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:C.red,width:75,textAlign:"right",flexShrink:0}}>
            -{fmtFull(tax)}
          </span>
        </div>

        {/* EXPENSES — below the line */}
        <h3 style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:C.red}}>
          SPENDING — {fmtFull(totalExpenses)}/mo
        </h3>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {expenses.map((item,i) => (
            <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.textMid,width:120,textAlign:"right",flexShrink:0}}>{item.label}</span>
              <div style={{flex:1,height:18,background:C.bg,borderRadius:4,overflow:"hidden"}}>
                <div style={{
                  width:`${Math.max(1,(item.amount/maxBar)*100)}%`,height:"100%",
                  background:`${item.color}33`,borderRadius:4,
                  borderRight:`2px solid ${item.color}`,
                  transition:"width 0.3s",
                }} />
              </div>
              <span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:C.textMid,width:75,textAlign:"right",flexShrink:0}}>
                -{fmtFull(item.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MonthBreakdown;
