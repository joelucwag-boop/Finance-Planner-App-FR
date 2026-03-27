import { C } from '../constants.js';

const Metric = ({label,value,sub,color=C.green,icon}) => (
  <div style={{
    background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
    padding:"14px 16px", flex:"1 1 0", minWidth:135, position:"relative", overflow:"hidden",
  }}>
    <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,
      background:color,opacity:0.06,borderRadius:"50%",filter:"blur(20px)"}} />
    <div style={{fontSize:10.5,color:C.textDim,marginBottom:5,letterSpacing:0.4}}>
      {icon} {label}
    </div>
    <div style={{fontSize:20,fontWeight:800,color,fontFamily:"monospace",letterSpacing:-0.5}}>
      {value}
    </div>
    {sub && <div style={{fontSize:10,color:C.textMid,marginTop:3}}>{sub}</div>}
  </div>
);

export default Metric;
