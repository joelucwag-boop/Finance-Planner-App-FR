import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  C, BASE, ENGINE_API, M, Y, EVENTS, SPEND_CAT, fmt, fmtFull, moName,
  decodeMonthlyRaw, FIELD_TO_ENGINE, toEngineParams, STORAGE_KEY,
} from "./constants.js";
import Metric from "./components/Metric.jsx";
import YearSlider from "./components/YearSlider.jsx";
import WaterfallChart from "./components/WaterfallChart.jsx";
import SankeyChart from "./components/SankeyChart.jsx";
import AccountTracker from "./components/AccountTracker.jsx";
import NetWorthChart from "./components/NetWorthChart.jsx";
import MonteCarloChart from "./components/MonteCarloChart.jsx";
import InputEditor from "./components/InputEditor.jsx";
import MonthBreakdown from "./components/MonthBreakdown.jsx";
import SpendDonut from "./components/SpendDonut.jsx";
import IncomeSpendChart from "./components/IncomeSpendChart.jsx";
import Timeline from "./components/Timeline.jsx";
import AuthModal from "./components/AuthModal.jsx";
import Header from "./components/Header.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import LoadingSkeleton from "./components/LoadingSkeleton.jsx";

export default function Dashboard() {
  const [selectedYear, setSelectedYear] = useState(2030);
  const [tab, setTab] = useState("cashflow");
  const [flowMode, setFlowMode] = useState("waterfall");

  // ── ENGINE STATE: live data from Python backend, fallback to baked-in ──
  const [liveM, setLiveM] = useState(null);
  const [liveY, setLiveY] = useState(null);
  const [engineUp, setEngineUp] = useState(false);
  const [engineMs, setEngineMs] = useState(0);
  const [engineLoading, setEngineLoading] = useState(true);

  // ── MONTE CARLO STATE ──
  const [mcData, setMcData] = useState(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState(null);
  const [mcNumSims, setMcNumSims] = useState(200);
  const [mcVol, setMcVol] = useState(0.16);

  // ── AUTH STATE ──
  const [authUser, setAuthUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── PLAN STATE ──
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [shareToken, setShareToken] = useState(null);
  const [planInputs, setPlanInputs] = useState(null); // inputs loaded from active plan
  const [planLoading, setPlanLoading] = useState(false);

  // Debounce timer ref for auto-saving plan
  const saveTimerRef = useRef(null);

  // Auth helpers
  const authHeaders = useCallback(() => {
    const h = {"Content-Type": "application/json"};
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  // Check for saved token on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fcc-auth-token");
      const savedUser = localStorage.getItem("fcc-auth-user");
      if (saved && savedUser) {
        setAuthToken(saved);
        setAuthUser(JSON.parse(savedUser));
      }
    } catch(e) {}
  }, []);

  // When token changes, verify with backend + load plans
  useEffect(() => {
    if (!authToken || !engineUp) return;
    (async () => {
      try {
        const meRes = await fetch(`${ENGINE_API}/auth/me`, {headers: authHeaders()});
        if (!meRes.ok) { setAuthToken(null); setAuthUser(null); localStorage.removeItem("fcc-auth-token"); return; }
        const plansRes = await fetch(`${ENGINE_API}/plans`, {headers: authHeaders()});
        if (plansRes.ok) {
          const p = await plansRes.json();
          setPlans(p);
          const def = p.find(x => x.is_default) || p[0];
          if (def) setActivePlanId(def.id);
        }
      } catch(e) {}
    })();
  }, [authToken, engineUp]);

  // Load plan inputs when activePlanId changes
  useEffect(() => {
    if (!authToken || !activePlanId || !engineUp) return;
    setPlanLoading(true);
    (async () => {
      try {
        const res = await fetch(`${ENGINE_API}/plans/${activePlanId}`, {headers: authHeaders()});
        if (res.ok) {
          const plan = await res.json();
          if (plan.inputs && Object.keys(plan.inputs).length > 0) {
            setPlanInputs(plan.inputs);
          } else {
            setPlanInputs(null);
          }
        }
      } catch(e) {}
      finally { setPlanLoading(false); }
    })();
  }, [activePlanId, authToken, engineUp]);

  // Auth submit handler
  const handleAuth = useCallback(async (e) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
      const body = authMode === "register"
        ? {email: authEmail, password: authPass, display_name: authName || authEmail.split("@")[0]}
        : {email: authEmail, password: authPass};
      const res = await fetch(`${ENGINE_API}${endpoint}`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Auth failed");
      setAuthToken(data.token);
      setAuthUser(data.user);
      localStorage.setItem("fcc-auth-token", data.token);
      localStorage.setItem("fcc-auth-user", JSON.stringify(data.user));
      setAuthMode(null);
      setAuthEmail(""); setAuthPass(""); setAuthName("");
    } catch(e) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  }, [authMode, authEmail, authPass, authName]);

  // Logout
  const handleLogout = useCallback(() => {
    setAuthToken(null); setAuthUser(null); setPlans([]);
    setActivePlanId(null); setShareToken(null); setPlanInputs(null);
    localStorage.removeItem("fcc-auth-token");
    localStorage.removeItem("fcc-auth-user");
  }, []);

  // Save current inputs to active plan on backend (debounced)
  const savePlanToBackend = useCallback(async (inputs) => {
    if (!authToken || !activePlanId) {
      // Anon fallback: save to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          inputs, savedAt: new Date().toISOString(), version: "v13",
        }));
      } catch(e) {}
      return;
    }
    // Clear existing timer and set new one (debounce 1.5s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setPlanSaving(true);
      try {
        await fetch(`${ENGINE_API}/plans/${activePlanId}`, {
          method: "PUT", headers: authHeaders(),
          body: JSON.stringify({inputs}),
        });
      } catch(e) {} finally { setPlanSaving(false); }
    }, 1500);
  }, [authToken, activePlanId]);

  // Create a new plan
  const createPlan = useCallback(async (name) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${ENGINE_API}/plans`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({name: name || "New Plan"}),
      });
      if (res.ok) {
        const p = await res.json();
        setPlans(prev => [p, ...prev]);
        setActivePlanId(p.id);
      }
    } catch(e) {}
  }, [authToken]);

  // Delete a plan
  const deletePlan = useCallback(async (id) => {
    if (!authToken || plans.length <= 1) return;
    try {
      await fetch(`${ENGINE_API}/plans/${id}`, {method: "DELETE", headers: authHeaders()});
      setPlans(prev => prev.filter(p => p.id !== id));
      if (activePlanId === id) setActivePlanId(plans.find(p => p.id !== id)?.id);
    } catch(e) {}
  }, [authToken, activePlanId, plans]);

  // Share plan
  const sharePlan = useCallback(async () => {
    if (!authToken || !activePlanId) return;
    try {
      const res = await fetch(`${ENGINE_API}/plans/${activePlanId}/share`, {
        method: "POST", headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setShareToken(data.token);
        const url = `${window.location.origin}${window.location.pathname}?shared=${data.token}`;
        try { await navigator.clipboard.writeText(url); } catch(e) {}
      }
    } catch(e) {}
  }, [authToken, activePlanId]);

  // Fetch Monte Carlo from backend — uses current plan inputs
  const runMonteCarlo = useCallback(async (currentInputs) => {
    setMcLoading(true);
    setMcError(null);
    try {
      // Map frontend inputs to backend engine params
      const engineInputs = currentInputs
        ? toEngineParams(currentInputs, BASE)
        : {};
      const res = await fetch(`${ENGINE_API}/monte-carlo`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ num_sims: mcNumSims, annual_vol: mcVol, inputs: engineInputs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMcData(data);
    } catch (e) {
      setMcError(e.message);
    } finally {
      setMcLoading(false);
    }
  }, [mcNumSims, mcVol]);

  // On mount, try to fetch baseline from the Python engine.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hRes = await fetch(`${ENGINE_API}/health`, {signal: AbortSignal.timeout(2000)});
        if (!hRes.ok) throw new Error("not healthy");
        const sRes = await fetch(`${ENGINE_API}/simulate`, {
          method:"POST", headers:{"Content-Type":"application/json"}, body:"{}",
        });
        if (!sRes.ok) throw new Error("sim failed");
        const data = await sRes.json();
        if (!cancelled) {
          setLiveM(decodeMonthlyRaw(data.monthly));
          setLiveY(data.yearly);
          setEngineUp(true);
          setEngineMs(data.metadata?.elapsed_ms || 0);
        }
      } catch(e) {
        console.warn("Engine offline, using baked data:", e.message);
      } finally {
        if (!cancelled) setEngineLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Active data: live engine results if available, else baked-in fallback
  const activeM = liveM || M;
  const activeY = liveY || Y;

  const yd = activeY.find(d => d.yr === selectedYear) || activeY[0];
  const finalYd = activeY[activeY.length - 1];

  const fontLink = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=JetBrains+Mono:wght@400;500;700&display=swap";

  const tabStyle = (t) => ({
    padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",
    fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif",
    letterSpacing:0.3,transition:"all 0.2s",
    background:tab===t?C.blue:"transparent",
    color:tab===t?"#fff":C.textMid,
  });

  return (
    <div style={{fontFamily:"'Outfit',sans-serif",
      background:`linear-gradient(180deg,${C.bg} 0%,#080e1a 100%)`,
      color:C.text,minHeight:"100vh",padding:"16px 14px"}}>
      <link href={fontLink} rel="stylesheet" />
      <style>{`input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:${C.blue};cursor:pointer;border:2px solid ${C.card};}`}</style>

      {/* Header */}
      <ErrorBoundary label="Header" icon="🏠">
        <Header
          engineUp={engineUp} engineMs={engineMs}
          activeM={activeM} activeY={activeY}
          authUser={authUser} plans={plans}
          activePlanId={activePlanId} setActivePlanId={setActivePlanId}
          createPlan={createPlan} sharePlan={sharePlan}
          shareToken={shareToken} handleLogout={handleLogout}
          setAuthMode={setAuthMode} setAuthError={setAuthError}
        />
      </ErrorBoundary>

      {/* Auth Modal */}
      {authMode && (
        <AuthModal
          authMode={authMode} setAuthMode={setAuthMode}
          authError={authError} authName={authName} setAuthName={setAuthName}
          authEmail={authEmail} setAuthEmail={setAuthEmail}
          authPass={authPass} setAuthPass={setAuthPass}
          handleAuth={handleAuth} authLoading={authLoading}
        />
      )}

      {/* Key Metrics */}
      {engineLoading ? (
        <LoadingSkeleton type="metrics" message="Connecting to engine..." />
      ) : (
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          <Metric icon="🎯" label="RETIREMENT NW" value={fmt(finalYd.nw)} sub="Age 66 · 2069" color={C.green}/>
          <Metric icon="📈" label="INVESTED" value={fmt(finalYd.inv)} sub={`401k: ${fmt(finalYd.k401)}`} color={C.blue}/>
          <Metric icon="🏠" label="HOME EQUITY" value={fmt(finalYd.home)} sub="Mortgage-free" color={C.purple}/>
          <Metric icon="💵" label={`${selectedYear} LEFT`}
            value={fmtFull(yd.left)}
            sub={yd.left>=0?"Surplus":"Deficit from savings"}
            color={yd.left>=0?C.green:C.red}/>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
        <button style={tabStyle("cashflow")} onClick={()=>setTab("cashflow")}>💧 Waterfall</button>
        <button style={tabStyle("accounts")} onClick={()=>setTab("accounts")}>🔍 Account Tracker</button>
        <button style={tabStyle("networth")} onClick={()=>setTab("networth")}>📈 Net Worth</button>
        <button style={tabStyle("editor")} onClick={()=>setTab("editor")}>📋 My Plan</button>
        <button style={tabStyle("breakdown")} onClick={()=>setTab("breakdown")}>🔬 Monthly Breakdown</button>
      </div>

      {/* Year Slider */}
      {(tab==="cashflow"||tab==="networth") && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
          padding:"10px 14px",marginBottom:14}}>
          <YearSlider year={selectedYear} onChange={setSelectedYear}/>
        </div>
      )}

      {/* ── WATERFALL TAB ── */}
      {tab==="cashflow" && (
        <ErrorBoundary label="Cash Flow" icon="💧">
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
            padding:"14px 10px 8px",marginBottom:14,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,padding:"0 4px"}}>
              <h2 style={{margin:0,fontSize:15,fontWeight:700}}>
                Cash Flow {flowMode==="sankey"?"Diagram":"Waterfall"} — {selectedYear}
              </h2>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10.5,color:C.textDim}}>Gross → Taxes → Spending → Leftover</span>
                <div style={{display:"flex",background:C.bg,borderRadius:6,border:`1px solid ${C.border}`,overflow:"hidden"}}>
                  <button onClick={()=>setFlowMode("waterfall")} style={{
                    padding:"3px 10px",border:"none",cursor:"pointer",fontSize:10,fontWeight:600,
                    background:flowMode==="waterfall"?C.blue:"transparent",
                    color:flowMode==="waterfall"?"#fff":C.textDim,
                    transition:"all 0.15s",
                  }}>Waterfall</button>
                  <button onClick={()=>setFlowMode("sankey")} style={{
                    padding:"3px 10px",border:"none",cursor:"pointer",fontSize:10,fontWeight:600,
                    background:flowMode==="sankey"?C.blue:"transparent",
                    color:flowMode==="sankey"?"#fff":C.textDim,
                    transition:"all 0.15s",
                  }}>Sankey</button>
                </div>
              </div>
            </div>
            {flowMode==="waterfall" ? (
              <WaterfallChart year={selectedYear}/>
            ) : (
              <SankeyChart year={selectedYear}/>
            )}
          </div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
            {SPEND_CAT[selectedYear] && (
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,flex:"0 0 auto"}}>
                <h3 style={{margin:"0 0 8px",fontSize:12,fontWeight:600,color:C.textMid}}>Spending — {selectedYear}</h3>
                <SpendDonut year={selectedYear}/>
              </div>
            )}
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,flex:"1 1 280px",minWidth:0}}>
              <h3 style={{margin:"0 0 6px",fontSize:12,fontWeight:600,color:C.textMid}}>Take-Home vs Spending Over Time</h3>
              <div style={{display:"flex",gap:12,marginBottom:4,fontSize:10.5}}>
                <span><span style={{color:C.green}}>■</span> Take-Home</span>
                <span><span style={{color:C.red}}>■</span> Spending</span>
              </div>
              <IncomeSpendChart/>
            </div>
          </div>
        </ErrorBoundary>
      )}

      {/* ── ACCOUNT TRACKER TAB ── */}
      {tab==="accounts" && (
        <ErrorBoundary label="Account Tracker" icon="🔍">
          <AccountTracker />
        </ErrorBoundary>
      )}

      {/* ── NET WORTH TAB ── */}
      {tab==="networth" && (
        <ErrorBoundary label="Net Worth" icon="📈">
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
            padding:"14px 10px 8px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2,padding:"0 4px"}}>
              <h2 style={{margin:0,fontSize:15,fontWeight:700}}>Net Worth Trajectory</h2>
              <span style={{fontSize:10.5,color:C.textDim}}>{BASE.startYear||2026}→{(BASE.startYear||2026)+43} · Stacked composition</span>
            </div>
            <div style={{display:"flex",gap:12,marginBottom:4,padding:"0 4px",fontSize:10.5}}>
              <span><span style={{color:"#3b82f6"}}>■</span> Invested</span>
              <span><span style={{color:"#a78bfa"}}>■</span> Home Equity</span>
              <span><span style={{color:"#06b6d4"}}>■</span> Cash</span>
              <span><span style={{color:"#ef4444"}}>■</span> Debt</span>
            </div>
            <NetWorthChart/>
          </div>
          {/* ── MONTE CARLO SIMULATION ── */}
          <ErrorBoundary label="Monte Carlo" icon="🎲">
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
              padding:"14px 10px 8px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,padding:"0 4px"}}>
                <div>
                  <h2 style={{margin:0,fontSize:15,fontWeight:700}}>Monte Carlo Simulation</h2>
                  <span style={{fontSize:10.5,color:C.textDim}}>
                    {mcData ? `${mcData.num_sims} sims · ${mcData.elapsed_ms}ms` : "Randomized return scenarios"}
                  </span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:10,color:C.textDim}}>Sims:</span>
                    <select value={mcNumSims} onChange={e=>setMcNumSims(+e.target.value)}
                      style={{background:C.bg,color:C.text,border:`1px solid ${C.border}`,
                        borderRadius:4,padding:"2px 4px",fontSize:10,outline:"none"}}>
                      <option value={50}>50</option><option value={100}>100</option>
                      <option value={200}>200</option><option value={500}>500</option>
                    </select>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:10,color:C.textDim}}>Vol:</span>
                    <select value={mcVol} onChange={e=>setMcVol(+e.target.value)}
                      style={{background:C.bg,color:C.text,border:`1px solid ${C.border}`,
                        borderRadius:4,padding:"2px 4px",fontSize:10,outline:"none"}}>
                      <option value={0.10}>Low (10%)</option>
                      <option value={0.16}>S&P (16%)</option>
                      <option value={0.22}>High (22%)</option>
                    </select>
                  </div>
                  <button onClick={() => runMonteCarlo(planInputs)} disabled={mcLoading || !engineUp}
                    style={{
                      background:mcLoading?C.amber+"22":C.blue+"22",
                      border:`1px solid ${mcLoading?C.amber:C.blue}44`,borderRadius:6,
                      padding:"5px 14px",color:mcLoading?C.amber:C.blue,fontSize:11,
                      fontWeight:700,cursor:mcLoading||!engineUp?"wait":"pointer",
                      opacity:engineUp?1:0.4,
                    }}>
                    {mcLoading ? "Running..." : mcData ? "Re-run" : "Run Simulation"}
                  </button>
                </div>
              </div>

              {mcError && (
                <div style={{padding:"8px 12px",background:C.redGlow,border:`1px solid ${C.red}33`,
                  borderRadius:8,marginBottom:8,fontSize:11,color:C.red}}>
                  {engineUp ? `Error: ${mcError}` : "Start the Python backend to enable Monte Carlo"}
                </div>
              )}

              {mcLoading && !mcData && (
                <LoadingSkeleton type="chart" message={`Running ${mcNumSims} simulations...`} />
              )}

              {mcData ? (<>
                <div style={{display:"flex",gap:10,marginBottom:4,padding:"0 6px",fontSize:10,flexWrap:"wrap"}}>
                  <span><span style={{color:"#3b82f6"}}>━━</span> Your Plan</span>
                  <span><span style={{color:"#22c55e"}}>╌╌</span> Median (P50)</span>
                  <span style={{color:C.textDim}}>Shaded = P10–P90 range</span>
                </div>
                <MonteCarloChart data={mcData}/>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10,padding:"0 4px"}}>
                  {[
                    {label:"$1M", prob:mcData.probabilities.hit_1m, color:C.green},
                    {label:"$2M", prob:mcData.probabilities.hit_2m, color:C.blue},
                    {label:"$5M", prob:mcData.probabilities.hit_5m, color:C.purple},
                    {label:"$8M", prob:mcData.probabilities.hit_8m, color:C.amber},
                  ].map(({label,prob,color}) => (
                    <div key={label} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
                      padding:"8px 12px",flex:"1 1 100px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.textDim,marginBottom:2}}>P(NW ≥ {label})</div>
                      <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",
                        color:prob>=0.7?C.green:prob>=0.4?C.amber:C.red}}>
                        {(prob*100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:12,marginTop:8,padding:"0 4px",fontSize:11,color:C.textDim}}>
                  <span>Mean terminal NW: <span style={{color:C.text,fontWeight:700,fontFamily:"monospace"}}>{fmt(mcData.probabilities.terminal_mean)}</span></span>
                  <span>Median: <span style={{color:C.text,fontWeight:700,fontFamily:"monospace"}}>{fmt(mcData.probabilities.terminal_median)}</span></span>
                </div>
              </>) : !mcLoading && (
                <div style={{textAlign:"center",padding:"40px 0",color:C.textDim}}>
                  {engineUp ? (
                    <div>
                      <div style={{fontSize:32,marginBottom:8}}>🎲</div>
                      <div style={{fontSize:12}}>Click "Run Simulation" to see how market volatility affects your plan</div>
                      <div style={{fontSize:10,marginTop:4}}>Runs {mcNumSims} randomized return paths through the engine</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:12}}>Monte Carlo requires the Python backend</div>
                      <div style={{fontSize:10,marginTop:4,color:C.amber}}>Start it: uvicorn main:app --port 8000</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ErrorBoundary>

          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:14}}>
            <h3 style={{margin:"0 0 10px",fontSize:12,fontWeight:600,color:C.textMid}}>Net Worth Milestones</h3>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {[
                {label:"Positive NW",yr:activeY.find(d=>d.nw>0)?.yr},
                {label:"$500K",yr:activeY.find(d=>d.nw>=500000)?.yr},
                {label:"$1M",yr:activeY.find(d=>d.nw>=1000000)?.yr},
                {label:"$2M",yr:activeY.find(d=>d.nw>=2000000)?.yr},
                {label:"$5M",yr:activeY.find(d=>d.nw>=5000000)?.yr},
                {label:"$8.5M",yr:2069},
              ].map((m,i)=>(
                <div key={i} style={{background:C.bg,borderRadius:8,padding:"7px 12px",border:`1px solid ${C.border}`,textAlign:"center",minWidth:80}}>
                  <div style={{fontSize:10,color:C.textDim,marginBottom:2}}>{m.label}</div>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:C.green}}>{m.yr||"—"}</div>
                  <div style={{fontSize:9.5,color:C.textDim}}>Age {m.yr?m.yr-(BASE.birthYear||2003):"—"}</div>
                </div>
              ))}
            </div>
          </div>
        </ErrorBoundary>
      )}

      {/* ── WHAT-IF EDITOR TAB ── */}
      {tab==="editor" && (
        <ErrorBoundary label="Plan Editor" icon="📋">
          {planLoading ? (
            <LoadingSkeleton type="chart" message="Loading plan..." />
          ) : (
            <InputEditor
              planInputs={planInputs}
              onSave={savePlanToBackend}
              planSaving={planSaving}
            />
          )}
        </ErrorBoundary>
      )}

      {/* ── MONTHLY BREAKDOWN TAB ── */}
      {tab==="breakdown" && (
        <ErrorBoundary label="Monthly Breakdown" icon="🔬">
          <MonthBreakdown />
        </ErrorBoundary>
      )}

      {/* Timeline (always) */}
      <ErrorBoundary label="Timeline" icon="📅">
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
          padding:"10px 14px",marginBottom:6,marginTop:14}}>
          <h3 style={{margin:"0 0 4px",fontSize:11,fontWeight:600,color:C.textDim}}>LIFE EVENTS</h3>
          <Timeline currentYear={selectedYear}/>
        </div>
      </ErrorBoundary>

      <div style={{textAlign:"center",padding:"10px 0 4px",fontSize:9.5,color:C.textDim}}>
        Financial Plan v13 · {activeM.length} months · {activeY.length} years · Powered by your spreadsheet engine
      </div>
    </div>
  );
}
