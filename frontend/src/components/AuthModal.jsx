import { C } from '../constants.js';

const AuthModal = ({authMode, setAuthMode, authError, authName, setAuthName, authEmail, setAuthEmail, authPass, setAuthPass, handleAuth, authLoading}) => {
  if (!authMode) return null;
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,
      background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:1000}} onClick={()=>setAuthMode(null)}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
        padding:24,width:320,maxWidth:"90vw"}} onClick={e=>e.stopPropagation()}>
        <h2 style={{margin:"0 0 16px",fontSize:18,fontWeight:700}}>
          {authMode==="register"?"Create Account":"Log In"}
        </h2>
        {authError && (
          <div style={{padding:"6px 10px",background:C.redGlow,border:`1px solid ${C.red}33`,
            borderRadius:6,marginBottom:10,fontSize:11,color:C.red}}>{authError}</div>
        )}
        {authMode==="register" && (
          <input placeholder="Display name" value={authName} onChange={e=>setAuthName(e.target.value)}
            style={{width:"100%",boxSizing:"border-box",padding:"8px 10px",marginBottom:8,
              background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,outline:"none"}}/>
        )}
        <input placeholder="Email" type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}
          style={{width:"100%",boxSizing:"border-box",padding:"8px 10px",marginBottom:8,
            background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,outline:"none"}}/>
        <input placeholder="Password" type="password" value={authPass} onChange={e=>setAuthPass(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleAuth()}
          style={{width:"100%",boxSizing:"border-box",padding:"8px 10px",marginBottom:12,
            background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,outline:"none"}}/>
        <button onClick={handleAuth} disabled={authLoading||!authEmail||!authPass}
          style={{width:"100%",padding:"8px",background:C.blue,color:"#fff",border:"none",
            borderRadius:6,fontSize:13,fontWeight:700,cursor:authLoading?"wait":"pointer",
            opacity:authLoading?0.6:1}}>
          {authLoading?"..." : authMode==="register"?"Create Account":"Log In"}
        </button>
        <div style={{marginTop:10,textAlign:"center",fontSize:11,color:C.textDim}}>
          {authMode==="register"
            ? <span>Have an account? <button onClick={()=>setAuthMode("login")}
                style={{background:"none",border:"none",color:C.blue,cursor:"pointer",fontSize:11,textDecoration:"underline"}}>Log in</button></span>
            : <span>Need an account? <button onClick={()=>setAuthMode("register")}
                style={{background:"none",border:"none",color:C.green,cursor:"pointer",fontSize:11,textDecoration:"underline"}}>Sign up</button></span>
          }
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
