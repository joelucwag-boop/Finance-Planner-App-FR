import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, BarChart, Bar } from 'recharts';
import { C, fmt, fmtFull, M, EVENTS, moName, ACCT_GROUPS } from '../constants.js';

const AccountTracker = () => {
  const [startYear, setStartYear] = useState(2026);
  const [span, setSpan] = useState(5);
  const [group, setGroup] = useState("cash");

  const endYear = startYear + span - 1;
  const months = useMemo(() =>
    M.filter(m => m.yr >= startYear && m.yr <= endYear),
    [startYear, endYear]
  );

  const grp = ACCT_GROUPS[group];
  // Filter out accounts that are zero for the entire range
  const activeAccounts = useMemo(() =>
    grp.accounts.filter(a => months.some(m => Math.abs(m[a.key]) > 10)),
    [grp, months]
  );

  // Find events in range
  const rangeEvents = EVENTS.filter(e => e.yr >= startYear && e.yr <= endYear);

  // ── DRAWDOWN ANALYSIS ──
  // For each deficit month, compute how much was pulled from each liquid account
  // by comparing this month's balance to previous month's balance.
  // A decrease in balance = money was withdrawn from that account to cover spending.
  const drawdowns = useMemo(() => {
    const result = [];
    for (let i = 1; i < months.length; i++) {
      const prev = months[i - 1], curr = months[i];
      // Only analyze months where spending exceeded income (negative leftover)
      if (curr.left >= 0) continue;

      // Compute how much each account decreased (positive = money was drawn out)
      const fromUnalloc = Math.max(0, prev.unalloc - curr.unalloc);
      const fromSav = Math.max(0, prev.sav - curr.sav);
      const fromSN = Math.max(0, prev.sn - curr.sn);
      // If shortfall balance increased, new borrowing occurred
      const newBorrow = Math.max(0, curr.short - prev.short);
      const total = fromUnalloc + fromSav + fromSN + newBorrow;

      if (total > 50) {
        result.push({
          name: `${moName[curr.mo]} ${curr.yr}`,
          yr: curr.yr, mo: curr.mo,
          deficit: Math.abs(curr.left),
          fromUnalloc, fromSav, fromSN, newBorrow, total,
        });
      }
    }
    return result;
  }, [months]);

  // Drawdown summary totals across entire range
  const ddSummary = useMemo(() => {
    const s = { unalloc: 0, sav: 0, sn: 0, borrow: 0, count: 0, worst: null };
    for (const d of drawdowns) {
      s.unalloc += d.fromUnalloc;
      s.sav += d.fromSav;
      s.sn += d.fromSN;
      s.borrow += d.newBorrow;
      s.count++;
      if (!s.worst || d.deficit > s.worst.deficit) s.worst = d;
    }
    s.total = s.unalloc + s.sav + s.sn + s.borrow;
    return s;
  }, [drawdowns]);

  // Build chart data — show every month, label every 3rd
  const chartData = months.map((m, i) => {
    const d = { name: `${moName[m.mo]} ${m.yr}`, idx: i };
    activeAccounts.forEach(a => { d[a.key] = m[a.key]; });
    d._leftover = m.left;
    d._nw = m.nw;
    return d;
  });

  // Detect drawdown months (leftover < 0)
  const drawdownMonths = months.filter(m => m.left < -200);

  // Summary stats
  const startMonth = months[0], endMonth = months[months.length - 1];

  const ttStyle = {
    background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
    padding:"8px 12px", fontSize:11, fontFamily:"monospace", lineHeight:1.6,
  };

  return (
    <div>
      {/* Controls */}
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div>
          <label style={{fontSize:10,color:C.textDim,display:"block",marginBottom:3}}>START YEAR</label>
          <select value={startYear} onChange={e=>setStartYear(Number(e.target.value))}
            style={{background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,
              padding:"6px 10px",fontSize:13,fontFamily:"monospace",cursor:"pointer"}}>
            {Array.from({length:40},(_,i)=>2026+i).map(y =>
              <option key={y} value={y}>{y}</option>
            )}
          </select>
        </div>
        <div>
          <label style={{fontSize:10,color:C.textDim,display:"block",marginBottom:3}}>RANGE</label>
          <div style={{display:"flex",gap:4}}>
            {[3,5,7,10].map(s => (
              <button key={s} onClick={()=>setSpan(s)} style={{
                padding:"6px 12px",borderRadius:6,border:`1px solid ${span===s?C.blue:C.border}`,
                background:span===s?C.blue+"22":"transparent",color:span===s?C.blue:C.textMid,
                fontSize:12,fontWeight:600,cursor:"pointer",
              }}>{s}yr</button>
            ))}
          </div>
        </div>
        <div style={{flex:1}} />
        <div>
          <label style={{fontSize:10,color:C.textDim,display:"block",marginBottom:3}}>ACCOUNT GROUP</label>
          <div style={{display:"flex",gap:4}}>
            {Object.entries(ACCT_GROUPS).map(([k,g]) => (
              <button key={k} onClick={()=>setGroup(k)} style={{
                padding:"6px 12px",borderRadius:6,border:`1px solid ${group===k?C.blue:C.border}`,
                background:group===k?C.blue+"22":"transparent",color:group===k?C.blue:C.textMid,
                fontSize:11.5,fontWeight:600,cursor:"pointer",
              }}>{g.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Drawdown alert */}
      {drawdownMonths.length > 0 && (
        <div style={{
          background:C.redGlow, border:`1px solid ${C.red}33`, borderRadius:8,
          padding:"8px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:8,
        }}>
          <span style={{fontSize:16}}>⚠️</span>
          <span style={{fontSize:11.5,color:C.red}}>
            <strong>{drawdownMonths.length} months</strong> in this range have negative cash flow
            (spending &gt; income). Accounts are being drawn down to cover shortfalls.
          </span>
        </div>
      )}

      {/* Main chart */}
      <div style={{
        background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
        padding:"14px 10px 8px", marginBottom:14,
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2,padding:"0 6px"}}>
          <h3 style={{margin:0,fontSize:14,fontWeight:700}}>
            {grp.label}: {startYear}–{endYear}
          </h3>
          <span style={{fontSize:10.5,color:C.textDim}}>Monthly balances · {months.length} months</span>
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{top:10,right:10,left:10,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="name" tick={{fill:C.textDim,fontSize:9}} tickLine={false}
              interval={Math.max(1, Math.floor(months.length / 12))} angle={-30} textAnchor="end" height={50} />
            <YAxis tick={{fill:C.textDim,fontSize:10}} tickLine={false}
              tickFormatter={v=>fmt(v)} width={55} />
            <Tooltip
              contentStyle={ttStyle}
              labelStyle={{color:C.text,fontWeight:700}}
              formatter={(v,n) => {
                const acct = activeAccounts.find(a=>a.key===n);
                return [fmtFull(v), acct?.label || n];
              }}
            />
            {/* Event reference lines */}
            {rangeEvents.map((e,i) => {
              const idx = chartData.findIndex(d => d.name === `${moName[e.mo]} ${e.yr}`);
              if (idx < 0) return null;
              return <ReferenceLine key={i} x={chartData[idx]?.name} stroke={C.amber} strokeDasharray="4 4"
                label={{value:e.emoji,position:"top",fontSize:14}} />;
            })}
            {activeAccounts.map(a => (
              <Line key={a.key} type="monotone" dataKey={a.key} stroke={a.color}
                strokeWidth={2} dot={false} name={a.key} />
            ))}
          </LineChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{display:"flex",flexWrap:"wrap",gap:"4px 14px",padding:"4px 6px"}}>
          {activeAccounts.map(a => (
            <div key={a.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
              <div style={{width:12,height:3,borderRadius:2,background:a.color}} />
              <span style={{color:C.textMid}}>{a.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Account change summary table */}
      {startMonth && endMonth && (
        <div style={{
          background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
          padding:14, marginBottom:14,
        }}>
          <h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:600,color:C.textMid}}>
            Balance Changes: {moName[startMonth.mo]} {startMonth.yr} → {moName[endMonth.mo]} {endMonth.yr}
          </h3>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5,fontFamily:"monospace"}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${C.border}`}}>
                  <th style={{textAlign:"left",padding:"6px 8px",color:C.textDim,fontWeight:500}}>Account</th>
                  <th style={{textAlign:"right",padding:"6px 8px",color:C.textDim,fontWeight:500}}>Start</th>
                  <th style={{textAlign:"right",padding:"6px 8px",color:C.textDim,fontWeight:500}}>End</th>
                  <th style={{textAlign:"right",padding:"6px 8px",color:C.textDim,fontWeight:500}}>Change</th>
                  <th style={{textAlign:"left",padding:"6px 8px",color:C.textDim,fontWeight:500,width:120}}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {activeAccounts.map(a => {
                  const sv = startMonth[a.key], ev = endMonth[a.key], delta = ev - sv;
                  const maxVal = Math.max(...months.map(m => m[a.key]));
                  const pct = maxVal > 0 ? (ev / maxVal) * 100 : 0;
                  return (
                    <tr key={a.key} style={{borderBottom:`1px solid ${C.border}15`}}>
                      <td style={{padding:"6px 8px",color:C.text,fontWeight:600}}>
                        <span style={{display:"inline-block",width:8,height:8,borderRadius:2,
                          background:a.color,marginRight:6,verticalAlign:"middle"}} />
                        {a.label}
                      </td>
                      <td style={{textAlign:"right",padding:"6px 8px",color:C.textMid}}>{fmtFull(sv)}</td>
                      <td style={{textAlign:"right",padding:"6px 8px",color:C.text,fontWeight:600}}>{fmtFull(ev)}</td>
                      <td style={{textAlign:"right",padding:"6px 8px",
                        color:group==="debt"?(delta<=0?C.green:C.red):(delta>=0?C.green:C.red),
                        fontWeight:600}}>
                        {delta>=0?"+":""}{fmtFull(delta)}
                      </td>
                      <td style={{padding:"6px 8px"}}>
                        <div style={{background:C.bg,borderRadius:3,height:8,width:100,overflow:"hidden"}}>
                          <div style={{height:8,width:`${Math.min(100,pct)}%`,background:a.color,
                            borderRadius:3,transition:"width 0.3s"}} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ DRAWDOWN FUNDING SOURCE ANALYSIS ═══ */}
      {/* Only renders when there are deficit months in the selected range */}
      {drawdowns.length > 0 && (
        <div style={{
          background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
          padding:14, marginBottom:14,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4,padding:"0 4px"}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:700,color:C.text}}>
              💸 Where The Money Came From
            </h3>
            <span style={{fontSize:10.5,color:C.textDim}}>
              {ddSummary.count} deficit months · {fmtFull(ddSummary.total)} total drawn
            </span>
          </div>
          <p style={{margin:"2px 0 10px",padding:"0 4px",fontSize:11,color:C.textDim,lineHeight:1.5}}>
            When spending exceeds income, the model taps accounts in priority order:
            Unallocated → Savings → Safety Net → Shortfall borrowing
          </p>

          {/* Summary cards — total drawn from each source */}
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            {[
              {label:"From Unallocated",val:ddSummary.unalloc,color:"#8b5cf6",icon:"🟣"},
              {label:"From Savings",val:ddSummary.sav,color:"#3b82f6",icon:"🔵"},
              {label:"From Safety Net",val:ddSummary.sn,color:"#06b6d4",icon:"🟢"},
              {label:"New Borrowing",val:ddSummary.borrow,color:"#ef4444",icon:"🔴"},
            ].filter(s => s.val > 0).map((s,i) => (
              <div key={i} style={{
                background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,
                padding:"10px 14px",flex:"1 1 120px",position:"relative",overflow:"hidden",
              }}>
                <div style={{position:"absolute",top:-15,right:-15,width:60,height:60,
                  background:s.color,opacity:0.07,borderRadius:"50%",filter:"blur(15px)"}} />
                <div style={{fontSize:10,color:C.textDim,marginBottom:4}}>{s.icon} {s.label}</div>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:s.color}}>
                  {fmtFull(s.val)}
                </div>
                <div style={{fontSize:9.5,color:C.textDim,marginTop:2}}>
                  {ddSummary.total > 0 ? ((s.val / ddSummary.total) * 100).toFixed(0) : 0}% of total draws
                </div>
              </div>
            ))}
          </div>

          {/* Worst month callout */}
          {ddSummary.worst && (
            <div style={{
              background:`${C.red}08`,border:`1px solid ${C.red}22`,borderRadius:10,
              padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:12,
            }}>
              <div style={{fontSize:24}}>🔻</div>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.red}}>
                  Worst Deficit: {ddSummary.worst.name}
                </div>
                <div style={{fontSize:11,color:C.textMid,marginTop:2}}>
                  Spending exceeded income by {fmtFull(ddSummary.worst.deficit)} —
                  covered by{" "}
                  {[
                    ddSummary.worst.fromUnalloc > 0 && `${fmt(ddSummary.worst.fromUnalloc)} unallocated`,
                    ddSummary.worst.fromSav > 0 && `${fmt(ddSummary.worst.fromSav)} savings`,
                    ddSummary.worst.fromSN > 0 && `${fmt(ddSummary.worst.fromSN)} safety net`,
                    ddSummary.worst.newBorrow > 0 && `${fmt(ddSummary.worst.newBorrow)} borrowing`,
                  ].filter(Boolean).join(", ")}
                </div>
              </div>
            </div>
          )}

          {/* Stacked bar chart — each bar is a deficit month, segments show funding source */}
          <div style={{marginBottom:6}}>
            <div style={{display:"flex",gap:12,padding:"0 4px",marginBottom:6,fontSize:10.5}}>
              <span><span style={{color:"#8b5cf6"}}>■</span> Unallocated</span>
              <span><span style={{color:"#3b82f6"}}>■</span> Savings</span>
              <span><span style={{color:"#06b6d4"}}>■</span> Safety Net</span>
              <span><span style={{color:"#ef4444"}}>■</span> Borrowing</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.min(320, 40 + drawdowns.length * 28)}>
              <BarChart data={drawdowns} layout="vertical" margin={{top:5,right:10,left:10,bottom:5}}
                barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                <XAxis type="number" tick={{fill:C.textDim,fontSize:10}} tickLine={false}
                  tickFormatter={v=>fmt(v)} />
                <YAxis type="category" dataKey="name" tick={{fill:C.textDim,fontSize:9}}
                  tickLine={false} width={65} />
                <Tooltip
                  contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
                    fontFamily:"monospace",fontSize:11,lineHeight:1.7}}
                  labelStyle={{color:C.text,fontWeight:700}}
                  formatter={(v,n) => {
                    const labels = {fromUnalloc:"Unallocated",fromSav:"Savings",fromSN:"Safety Net",newBorrow:"Borrowing"};
                    return [fmtFull(v), labels[n] || n];
                  }}
                />
                <Bar dataKey="fromUnalloc" stackId="draw" fill="#8b5cf6" radius={[0,0,0,0]} />
                <Bar dataKey="fromSav" stackId="draw" fill="#3b82f6" />
                <Bar dataKey="fromSN" stackId="draw" fill="#06b6d4" />
                <Bar dataKey="newBorrow" stackId="draw" fill="#ef4444" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed table — every deficit month with exact funding breakdown */}
          <details style={{marginTop:8}}>
            <summary style={{cursor:"pointer",fontSize:11.5,color:C.blue,fontWeight:600,
              padding:"6px 0",userSelect:"none"}}>
              Show all {drawdowns.length} deficit months →
            </summary>
            <div style={{overflowX:"auto",marginTop:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border}`}}>
                    <th style={{textAlign:"left",padding:"5px 6px",color:C.textDim,fontWeight:500}}>Month</th>
                    <th style={{textAlign:"right",padding:"5px 6px",color:C.textDim,fontWeight:500}}>Deficit</th>
                    <th style={{textAlign:"right",padding:"5px 6px",color:"#8b5cf6",fontWeight:500}}>Unalloc</th>
                    <th style={{textAlign:"right",padding:"5px 6px",color:"#3b82f6",fontWeight:500}}>Savings</th>
                    <th style={{textAlign:"right",padding:"5px 6px",color:"#06b6d4",fontWeight:500}}>Safety Net</th>
                    <th style={{textAlign:"right",padding:"5px 6px",color:"#ef4444",fontWeight:500}}>Borrow</th>
                  </tr>
                </thead>
                <tbody>
                  {drawdowns.map((d,i) => (
                    <tr key={i} style={{borderBottom:`1px solid ${C.border}10`}}>
                      <td style={{padding:"4px 6px",color:C.text,fontWeight:500}}>{d.name}</td>
                      <td style={{textAlign:"right",padding:"4px 6px",color:C.red,fontWeight:600}}>{fmtFull(d.deficit)}</td>
                      <td style={{textAlign:"right",padding:"4px 6px",color:d.fromUnalloc>0?"#8b5cf6":C.border}}>
                        {d.fromUnalloc > 0 ? fmtFull(d.fromUnalloc) : "—"}
                      </td>
                      <td style={{textAlign:"right",padding:"4px 6px",color:d.fromSav>0?"#3b82f6":C.border}}>
                        {d.fromSav > 0 ? fmtFull(d.fromSav) : "—"}
                      </td>
                      <td style={{textAlign:"right",padding:"4px 6px",color:d.fromSN>0?"#06b6d4":C.border}}>
                        {d.fromSN > 0 ? fmtFull(d.fromSN) : "—"}
                      </td>
                      <td style={{textAlign:"right",padding:"4px 6px",color:d.newBorrow>0?"#ef4444":C.border}}>
                        {d.newBorrow > 0 ? fmtFull(d.newBorrow) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};

export default AccountTracker;
