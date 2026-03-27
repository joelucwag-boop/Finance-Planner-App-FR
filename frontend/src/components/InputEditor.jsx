import { useState, useEffect, useMemo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { C, BASE, INPUT_SECTIONS, STORAGE_KEY, SCENARIO_STORAGE_KEY, SCENARIO_COLORS, SCENARIO_PRESETS, Y, fmt, fmtFull, fmtInput, _store } from '../constants.js';
import { runMonthlyEngine, ENGINE_BASELINE_BY_YR, computeScenarioNW } from '../engine.js';
import InputSection from './InputSection.jsx';

const InputEditor = ({ planInputs, onSave, planSaving }) => {
  const [inputs, setInputs] = useState({...BASE});
  const [openSections, setOpenSections] = useState(new Set(["you","job"]));
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | loaded
  const [lastSaved, setLastSaved] = useState(null);

  // Load plan inputs from backend when available, else from local storage
  useEffect(() => {
    if (planInputs && Object.keys(planInputs).length > 0) {
      setInputs(prev => ({...BASE, ...planInputs}));
      setSaveStatus("loaded");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }
    // Fallback: load from local storage for anon users
    (async () => {
      try {
        const result = await _store.get(STORAGE_KEY);
        if (result?.value) {
          const saved = JSON.parse(result.value);
          setInputs(prev => ({...BASE, ...saved.inputs}));
          setLastSaved(saved.savedAt);
          setSaveStatus("loaded");
          setTimeout(() => setSaveStatus("idle"), 2000);
        }
      } catch (e) { /* no saved data yet, that's fine */ }
    })();
  }, [planInputs]);

  const set = (key, val) => setInputs(prev => ({...prev, [key]: val}));

  // Save to persistent storage + backend
  const save = async () => {
    setSaveStatus("saving");
    try {
      const ts = new Date().toISOString();
      // Save to local storage as fallback
      await _store.set(STORAGE_KEY, JSON.stringify({
        inputs, savedAt: ts, version: "v13",
      }));
      // Also save to backend if callback provided
      if (onSave) onSave(inputs);
      setLastSaved(ts);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (e) {
      setSaveStatus("idle");
    }
  };

  // Reset to baseline
  const reset = async () => {
    setInputs({...BASE});
    try { await _store.delete(STORAGE_KEY); } catch(e) {}
    if (onSave) onSave({...BASE});
    setSaveStatus("idle");
    setLastSaved(null);
  };

  const toggleSection = (id) => setOpenSections(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  // ── SCENARIO STATE ──
  const [scenarios, setScenarios] = useState([]);  // [{name, emoji, color, overrides, nwData}]
  const [showScenarios, setShowScenarios] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");



  // ── RELATIVE DELTA APPROACH ──
  // The monthly engine can't perfectly replicate the 62-column Excel model, so small
  // systematic differences compound into large NW divergences over 44 years.
  // Fix: run the engine twice (baseline + modified), take the DELTA, add to baked Excel data.
  // When inputs === BASE, delta = 0, so modified === baseline (exact match).
  // When inputs differ, only the actual impact of changes shows.
  // Use pre-computed module-level baseline (avoids 523-month sim on every tab switch)
  const engineBaseline = ENGINE_BASELINE_BY_YR;

  // Only run the modified engine if inputs actually differ from BASE.
  // This skips the expensive 523-month simulation on initial mount (inputs === BASE).
  const changedKeys = useMemo(() =>
    Object.keys(inputs).filter(k => inputs[k] !== BASE[k]),
    [inputs]
  );
  const engineModified = useMemo(() => {
    // No changes → return baseline directly (zero-cost, no engine run)
    if (changedKeys.length === 0) return engineBaseline;
    // Inputs changed → run the full engine with modified inputs
    const byYr = {};
    for (const row of runMonthlyEngine(inputs).yearly) byYr[row.yr] = row;
    return byYr;
  }, [inputs, changedKeys.length, engineBaseline]);

  // Load saved scenarios on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await _store.get(SCENARIO_STORAGE_KEY);
        if (result?.value) {
          const saved = JSON.parse(result.value);
          // Recompute NW trajectories for each saved scenario (overrides only stored)
          const withNW = saved.map((s,i) => ({
            ...s,
            color: s.color || SCENARIO_COLORS[i % SCENARIO_COLORS.length],
            nwData: computeScenarioNW(s.overrides, inputs, engineModified),
          }));
          setScenarios(withNW);
        }
      } catch(e) { /* no scenarios yet */ }
    })();
  }, [inputs, engineModified]);

  // Persist scenarios whenever they change (store overrides only, not nwData)
  const persistScenarios = useCallback(async (scList) => {
    try {
      const toStore = scList.map(s => ({
        name: s.name, emoji: s.emoji || "", color: s.color, overrides: s.overrides,
      }));
      await _store.set(SCENARIO_STORAGE_KEY, JSON.stringify(toStore));
    } catch(e) {}
  }, []);

  // Add a scenario (from presets or from current inputs)
  const addScenario = useCallback((name, emoji, overrides, color) => {
    setScenarios(prev => {
      // Don't duplicate by name
      if (prev.some(s => s.name === name)) return prev;
      const c = color || SCENARIO_COLORS[prev.length % SCENARIO_COLORS.length];
      const nwData = computeScenarioNW(overrides, inputs, engineModified);
      const next = [...prev, {name, emoji: emoji||"📊", color: c, overrides, nwData}];
      persistScenarios(next);
      return next;
    });
  }, [inputs, engineModified, persistScenarios]);

  // Add current What-If inputs as a named scenario
  const saveCurrentAsScenario = useCallback(() => {
    if (!newScenarioName.trim()) return;
    // Only store the fields that differ from BASE
    const overrides = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (v !== BASE[k]) overrides[k] = v;
    }
    addScenario(newScenarioName.trim(), "💡", overrides);
    setNewScenarioName("");
  }, [inputs, newScenarioName, addScenario]);

  // Remove a scenario
  const removeScenario = useCallback((name) => {
    setScenarios(prev => {
      const next = prev.filter(s => s.name !== name);
      persistScenarios(next);
      return next;
    });
  }, [persistScenarios]);

  // Load a scenario into the input sliders
  const loadScenario = useCallback((overrides) => {
    setInputs({...BASE, ...overrides});
  }, []);

  // Build adjusted yearly data: baked Excel + (engine_modified - engine_baseline)
  const modified = useMemo(() =>
    Y.map(yb => {
      const eb = engineBaseline[yb.yr] || yb;
      const em = engineModified[yb.yr];
      if (!em) return {...yb}; // no engine data for this year, return baseline
      return {
        yr: yb.yr,
        gross: yb.gross + (em.gross - eb.gross),
        tax: yb.tax + (em.tax - eb.tax),
        take: yb.take + (em.take - eb.take),
        spend: yb.spend + (em.spend - eb.spend),
        left: yb.left + (em.left - eb.left),
        nw: yb.nw + (em.nw - eb.nw),
        debt: yb.debt + (em.debt - eb.debt),
        sn: yb.sn + (em.sn - (eb.sn || 0)),
        sav: yb.sav + (em.sav - (eb.sav || 0)),
        inv: yb.inv + (em.inv - eb.inv),
        home: yb.home + (em.home - eb.home),
        mort: yb.mort + (em.mort - eb.mort),
        k401: yb.k401 + (em.k401 - eb.k401),
        tsp: yb.tsp + (em.tsp - eb.tsp),
        roth: yb.roth + (em.roth - eb.roth),
        brok: yb.brok + (em.brok - eb.brok),
      };
    }),
    [engineBaseline, engineModified]
  );

  const baseEnd = Y[Y.length - 1];
  // Build a year→nw map for fast lookup instead of index-based alignment
  const modByYear = useMemo(() => {
    const m = {};
    for (const row of modified) m[row.yr] = row;
    return m;
  }, [modified]);
  const modEnd = modByYear[baseEnd.yr] || modified[modified.length - 1] || {nw:0};

  // Build chart data with baseline + current modified + all saved scenarios
  const chartData = Y.map((yb, i) => {
    const row = { yr: yb.yr, baseline: yb.nw, modified: modByYear[yb.yr]?.nw || 0 };
    // Add each scenario's NW for this year index
    scenarios.forEach((sc, si) => {
      row[`sc_${si}`] = sc.nwData?.[i] ?? yb.nw;
    });
    return row;
  });

  const effectiveStatus = planSaving ? "syncing" : saveStatus;
  const statusColors = {saving:C.amber, saved:C.green, loaded:C.cyan, idle:C.textDim, syncing:C.amber};
  const statusText = {saving:"Saving...", saved:"Saved ✓", loaded:"Loaded from plan", idle:"", syncing:"Syncing..."};

  return (
    <div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        {/* Input panel (left side / scrollable) */}
        <div style={{
          background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
          padding:"12px 14px", flex:"0 0 300px", maxWidth:340,
          maxHeight:"80vh", overflowY:"auto",
          scrollbarWidth:"thin", scrollbarColor:`${C.border} transparent`,
        }}>
          {/* Header with save controls */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:10,padding:"0 2px",position:"sticky",top:0,
            background:C.card,zIndex:2,paddingBottom:8,
            borderBottom:`1px solid ${C.border}`}}>
            <div>
              <h3 style={{margin:0,fontSize:14,fontWeight:700}}>📋 My Plan</h3>
            </div>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {effectiveStatus !== "idle" && (
                <span style={{fontSize:10,color:statusColors[effectiveStatus],fontWeight:600}}>
                  {statusText[effectiveStatus]}
                </span>
              )}
              <button onClick={save} style={{
                background:C.green+"22",border:`1px solid ${C.green}44`,borderRadius:6,
                padding:"4px 10px",color:C.green,fontSize:10,fontWeight:700,cursor:"pointer",
              }}>💾 Save Plan</button>
              <button onClick={reset} style={{
                  background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,
                  padding:"4px 8px",color:C.textDim,fontSize:10,cursor:"pointer",
                }} title="Reset to v13 defaults">↩</button>
            </div>
          </div>

          {lastSaved && (
            <div style={{fontSize:9,color:C.textDim,marginBottom:8,padding:"0 2px"}}>
              Last saved: {new Date(lastSaved).toLocaleString()}
            </div>
          )}

          {/* Sections */}
          {INPUT_SECTIONS.map(sec => {
            const dimmed = (sec.id==="wed" && String(inputs.weddingEnabled)!=="true" && inputs.weddingEnabled!==true)
              || (sec.id==="wife" && String(inputs.partnerEnabled)!=="true" && inputs.partnerEnabled!==true)
              || (sec.id==="guard" && String(inputs.guardEnabled)!=="true" && inputs.guardEnabled!==true)
              || (sec.id==="kids" && String(inputs.kidsEnabled)!=="true" && inputs.kidsEnabled!==true);
            return (
              <div key={sec.id} style={{opacity:dimmed?0.35:1,transition:"opacity 0.2s"}}>
                <InputSection section={sec} inputs={inputs}
                  onChange={set} isOpen={openSections.has(sec.id)}
                  toggle={() => toggleSection(sec.id)} />
              </div>
            );
          })}
        </div>

        {/* Results panel (right side) */}
        <div style={{flex:1,minWidth:0}}>
          {/* Plan Summary */}
          <div style={{
            background:C.greenGlow, border:`1px solid ${C.green}33`,
            borderRadius:12, padding:"12px 16px", marginBottom:14,
          }}>
            <div style={{fontSize:12,color:C.textMid,marginBottom:6,fontWeight:600}}>
              Your Plan — Retire at {inputs.retireAge || 67}
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:10,color:C.textDim}}>2069 Net Worth</div>
                <div style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:C.green}}>
                  {fmt(modEnd.nw)}
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.textDim}}>Invested</div>
                <div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:C.blue}}>
                  {fmt((modEnd.inv != null) ? modEnd.inv : ((modEnd.k401||0)+(modEnd.tsp||0)+(modEnd.roth||0)+(modEnd.brok||0)))}
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.textDim}}>Home Equity</div>
                <div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:C.purple}}>
                  {fmt(Math.max(0,(modEnd.home||0)-(modEnd.mort||0)))}
                </div>
              </div>
            </div>
          </div>

          {/* Comparison chart */}
          <div style={{
            background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
            padding:"14px 10px 8px", marginBottom:14,
          }}>
            <h3 style={{margin:"0 0 4px",fontSize:13,fontWeight:600,color:C.textMid,padding:"0 6px"}}>
              Net Worth Projection
            </h3>
            <div style={{display:"flex",gap:10,marginBottom:4,padding:"0 6px",fontSize:10,flexWrap:"wrap"}}>
              <span><span style={{color:C.blue}}>━━</span> My Plan</span>
              {scenarios.map((sc,i) => (
                <span key={sc.name}><span style={{color:sc.color}}>━━</span> {sc.emoji} {sc.name}</span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{top:10,right:10,left:10,bottom:5}}>
                <defs>
                  <linearGradient id="agBase" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.textDim} stopOpacity={0.2}/>
                    <stop offset="100%" stopColor={C.textDim} stopOpacity={0.02}/>
                  </linearGradient>
                  <linearGradient id="agMod" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.3}/>
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="yr" tick={{fill:C.textDim,fontSize:10}} tickLine={false} interval={4} />
                <YAxis tick={{fill:C.textDim,fontSize:10}} tickLine={false}
                  tickFormatter={v=>fmt(v)} width={55} />
                <Tooltip
                  contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontFamily:"monospace",fontSize:12}}
                  labelStyle={{color:C.text,fontWeight:700}}
                  formatter={(v,n) => {
                    if (n==="baseline") return [fmtFull(v), "v13 Reference"];
                    if (n==="modified") return [fmtFull(v), "My Plan"];
                    // Scenario lines: n = "sc_0", "sc_1", etc.
                    const si = parseInt(n.replace("sc_",""),10);
                    const sc = scenarios[si];
                    return [fmtFull(v), sc ? `${sc.emoji} ${sc.name}` : n];
                  }}
                />
                <Area type="monotone" dataKey="modified" stroke={C.blue} fill="url(#agMod)"
                  strokeWidth={2.5} />
                {/* Scenario overlay lines — no fill, just colored strokes */}
                {scenarios.map((sc,i) => (
                  <Area key={sc.name} type="monotone" dataKey={`sc_${i}`}
                    stroke={sc.color} fill="none" strokeWidth={2}
                    strokeDasharray={i%2===0?"":"5 3"} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Plan milestones */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
            {[
              {label:"Year 5",yr:Y[4]?.yr},
              {label:"Year 10",yr:Y[9]?.yr},
              {label:"Year 20",yr:Y[19]?.yr},
              {label:"Retirement",yr:baseEnd.yr},
            ].map(({label,yr}) => {
              const modRow = modByYear[yr] || {nw:0};
              return (
                <div key={label} style={{
                  background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
                  padding:"8px 12px",flex:"1 1 100px",textAlign:"center",
                }}>
                  <div style={{fontSize:10,color:C.textDim,marginBottom:2}}>{label} ({yr})</div>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:C.green}}>
                    {fmt(modRow.nw)}
                  </div>
                  <div style={{fontSize:9.5,color:C.textDim}}>Age {yr-(inputs.birthYear||BASE.birthYear||2003)}</div>
                </div>
              );
            })}
          </div>

          {/* Plan Details */}
          <div style={{
            background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
            padding:14,
          }}>
            <h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:600,color:C.textMid}}>
              Plan Details
            </h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
              {[
                {label:"Hourly Rate",val:fmtInput(inputs.hourlyRate,"$/hr")},
                {label:"Annual Raise",val:fmtInput(inputs.raise,"%")},
                {label:"Wife Salary",val:fmtInput(inputs.wifeStart,"$K")},
                {label:"Retire Age",val:String(inputs.retireAge)},
                {label:"House Price",val:fmtInput(inputs.housePrice,"$K")},
                {label:"Mortgage",val:`${inputs.mortYears}yr @ ${fmtInput(inputs.mortRate,"%2")}`},
                {label:"401(k)",val:fmtInput(inputs.k401pct,"%")},
                {label:"Inv Return",val:fmtInput(inputs.invReturn,"%")},
                {label:"Kids",val:String(inputs.numKids)},
                {label:"Inflation",val:fmtInput(inputs.inflation,"%")},
              ].map(({label,val}) => (
                <div key={label} style={{
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"4px 8px",background:C.bg,borderRadius:6,fontSize:11,
                }}>
                  <span style={{color:C.textDim}}>{label}</span>
                  <span style={{color:C.text,fontWeight:600,fontFamily:"monospace"}}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── SCENARIO MANAGER ── */}
          <div style={{
            background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
            padding:14, marginTop:14,
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h3 style={{margin:0,fontSize:13,fontWeight:600,color:C.textMid}}>
                🔀 Scenario Comparison
              </h3>
              <button onClick={()=>setShowScenarios(p=>!p)} style={{
                background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,
                padding:"3px 8px",color:C.textDim,fontSize:10,cursor:"pointer",
              }}>{showScenarios?"Hide":"Manage"}</button>
            </div>

            {/* Quick-add presets */}
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
              {SCENARIO_PRESETS.map(p => {
                const isActive = scenarios.some(s => s.name === p.name);
                return (
                  <button key={p.name} onClick={() => isActive
                    ? removeScenario(p.name)
                    : addScenario(p.name, p.emoji, p.overrides, p.color)
                  } style={{
                    background: isActive ? `${p.color}22` : C.bg,
                    border: `1px solid ${isActive ? p.color+"66" : C.border}`,
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                    color: isActive ? p.color : C.textMid, fontSize: 11, fontWeight: 600,
                    transition: "all 0.15s",
                  }}>
                    {p.emoji} {p.name}
                  </button>
                );
              })}
            </div>

            {/* Active scenario summary chips */}
            {scenarios.length > 0 && (
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:showScenarios?10:0}}>
                {scenarios.map(sc => {
                  const scEnd = sc.nwData?.[sc.nwData.length-1] || 0;
                  const diff = scEnd - modEnd.nw;
                  return (
                    <div key={sc.name} style={{
                      background:`${sc.color}15`, border:`1px solid ${sc.color}33`,
                      borderRadius:8, padding:"5px 10px", display:"flex", alignItems:"center", gap:8,
                    }}>
                      <span style={{fontSize:11,fontWeight:600,color:sc.color}}>{sc.emoji} {sc.name}</span>
                      <span style={{fontSize:11,fontFamily:"monospace",fontWeight:700,
                        color:diff>=0?C.green:C.red}}>
                        {diff>=0?"+":""}{fmt(diff)}
                      </span>
                      <button onClick={()=>removeScenario(sc.name)} style={{
                        background:"transparent",border:"none",color:C.textDim,
                        cursor:"pointer",fontSize:12,padding:0,lineHeight:1,
                      }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Expanded scenario manager */}
            {showScenarios && (<>
              {/* Save current inputs as custom scenario */}
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                  <input value={newScenarioName}
                    onChange={e=>setNewScenarioName(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&saveCurrentAsScenario()}
                    placeholder="Name this scenario..."
                    style={{
                      flex:1, background:C.bg, color:C.text, border:`1px solid ${C.border}`,
                      borderRadius:6, padding:"5px 8px", fontSize:11, outline:"none",
                    }} />
                  <button onClick={saveCurrentAsScenario} disabled={!newScenarioName.trim()} style={{
                    background:C.blue+"22",border:`1px solid ${C.blue}44`,borderRadius:6,
                    padding:"5px 12px",color:C.blue,fontSize:10,fontWeight:700,cursor:"pointer",
                    opacity:newScenarioName.trim()?1:0.4,
                  }}>Save Current</button>
                </div>

              {/* Detailed scenario cards */}
              {scenarios.map(sc => {
                const scEnd = sc.nwData?.[sc.nwData.length-1] || 0;
                const diff = scEnd - Y[Y.length-1].nw;
                const overrideCount = Object.keys(sc.overrides).length;
                return (
                  <div key={sc.name} style={{
                    background:C.bg, border:`1px solid ${C.border}`, borderRadius:10,
                    padding:"10px 12px", marginBottom:6,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div>
                        <span style={{fontSize:12,fontWeight:700,color:sc.color}}>{sc.emoji} {sc.name}</span>
                        <span style={{fontSize:9,color:C.textDim,marginLeft:6}}>{overrideCount} changes</span>
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>loadScenario(sc.overrides)} style={{
                          background:`${C.blue}15`,border:`1px solid ${C.blue}33`,borderRadius:5,
                          padding:"2px 8px",color:C.blue,fontSize:9,fontWeight:600,cursor:"pointer",
                        }}>Load</button>
                        <button onClick={()=>removeScenario(sc.name)} style={{
                          background:`${C.red}15`,border:`1px solid ${C.red}33`,borderRadius:5,
                          padding:"2px 8px",color:C.red,fontSize:9,fontWeight:600,cursor:"pointer",
                        }}>Remove</button>
                      </div>
                    </div>
                    {/* Terminal NW comparison */}
                    <div style={{display:"flex",gap:12,fontSize:11}}>
                      <span style={{color:C.textDim}}>vs My Plan:</span>
                      <span style={{fontFamily:"monospace",fontWeight:700,color:sc.color}}>{fmt(scEnd)}</span>
                      <span style={{fontFamily:"monospace",fontWeight:700,
                        color:diff>=0?C.green:C.red}}>({diff>=0?"+":""}{fmt(diff)})</span>
                    </div>
                    {/* Key overrides */}
                    <div style={{marginTop:4,display:"flex",gap:4,flexWrap:"wrap"}}>
                      {Object.entries(sc.overrides).slice(0,5).map(([k,v]) => {
                        const field = INPUT_SECTIONS.flatMap(s=>s.fields).find(f=>f.key===k);
                        return (
                          <span key={k} style={{
                            fontSize:9,background:`${sc.color}10`,border:`1px solid ${sc.color}22`,
                            borderRadius:4,padding:"1px 5px",color:sc.color,
                          }}>
                            {field?.label||k}: {field ? fmtInput(v,field.fmt) : v}
                          </span>
                        );
                      })}
                      {Object.keys(sc.overrides).length > 5 && (
                        <span style={{fontSize:9,color:C.textDim}}>
                          +{Object.keys(sc.overrides).length-5} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {scenarios.length === 0 && (
                <div style={{textAlign:"center",padding:"12px 0",color:C.textDim,fontSize:11}}>
                  Click a preset above or modify inputs and save as a custom scenario
                </div>
              )}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InputEditor;
