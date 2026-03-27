import { C } from '../constants.js';

const Header = ({engineUp, engineMs, activeM, activeY, authUser, plans, activePlanId, setActivePlanId, createPlan, sharePlan, shareToken, handleLogout, setAuthMode, setAuthError}) => (
  <div style={{marginBottom:16}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <h1 style={{fontSize:24,fontWeight:800,margin:0,letterSpacing:-0.5,
          background:"linear-gradient(135deg,#e2e8f0 0%,#94a3b8 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
          Financial Command Center
        </h1>
        <p style={{margin:"3px 0 0",fontSize:11.5,color:C.textDim}}>
          50-year projection · v13 engine · {activeM.length} months · {activeY.length} years
        </p>
        <span style={{fontSize:10,fontWeight:600,
          color:engineUp?"#4ade80":"#f97316",marginLeft:8}}>
          {engineUp ? `● Live Engine (${engineMs}ms)` : "● Offline (cached data)"}
        </span>
      </div>

      {/* Auth / Plan controls — top right */}
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {authUser ? (<>
          {/* Plan selector */}
          {plans.length > 0 && (
            <select value={activePlanId||""} onChange={e => setActivePlanId(+e.target.value)}
              style={{background:C.bg,color:C.text,border:`1px solid ${C.border}`,
                borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:600,outline:"none",maxWidth:140}}>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {/* New plan button */}
          <button onClick={()=>createPlan(prompt("Plan name:","New Plan"))}
            style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,
              padding:"4px 8px",fontSize:10,color:C.textMid,cursor:"pointer"}}>+ New</button>
          {/* Share */}
          {activePlanId && (
            <button onClick={sharePlan}
              style={{background:C.blue+"22",border:`1px solid ${C.blue}44`,borderRadius:6,
                padding:"4px 8px",fontSize:10,color:C.blue,fontWeight:600,cursor:"pointer"}}>
              {shareToken?"Copied!":"Share"}
            </button>
          )}
          {/* User badge + logout */}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10,color:C.textMid,fontWeight:600}}>{authUser.display_name}</span>
            <button onClick={handleLogout}
              style={{background:"transparent",border:"none",color:C.textDim,
                fontSize:9,cursor:"pointer",padding:"2px 4px",textDecoration:"underline"}}>
              Logout
            </button>
          </div>
        </>) : engineUp ? (
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setAuthMode("login");setAuthError("");}}
              style={{background:C.blue+"22",border:`1px solid ${C.blue}44`,borderRadius:6,
                padding:"4px 12px",fontSize:10,color:C.blue,fontWeight:700,cursor:"pointer"}}>
              Log In
            </button>
            <button onClick={()=>{setAuthMode("register");setAuthError("");}}
              style={{background:C.green+"22",border:`1px solid ${C.green}44`,borderRadius:6,
                padding:"4px 12px",fontSize:10,color:C.green,fontWeight:700,cursor:"pointer"}}>
              Sign Up
            </button>
          </div>
        ) : null}
      </div>
    </div>
  </div>
);

export default Header;
