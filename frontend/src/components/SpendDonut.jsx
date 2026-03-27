import { C, fmt, SPEND_CAT } from '../constants.js';

const SpendDonut = ({year}) => {
  const sc = SPEND_CAT[year];
  if (!sc) return null;
  const items = [
    {label:"Housing",val:sc.housing,color:"#3b82f6"},
    {label:"Health",val:sc.health,color:"#22c55e"},
    {label:"Kids",val:sc.kids,color:"#f59e0b"},
    {label:"Cars",val:Math.max(0,sc.car),color:"#a78bfa"},
    {label:"Bills",val:sc.bills,color:"#06b6d4"},
    {label:"Debt",val:sc.debt,color:"#ef4444"},
  ].filter(i=>i.val>100);
  const total = items.reduce((s,i)=>s+i.val,0);
  const cx=80,cy=80,r=60,r2=38;
  let angle=-Math.PI/2;
  const arcs = items.map(item => {
    const sweep=(item.val/total)*2*Math.PI;
    const sa=angle; angle+=sweep; const ea=angle;
    const x1=cx+r*Math.cos(sa),y1=cy+r*Math.sin(sa),x2=cx+r*Math.cos(ea),y2=cy+r*Math.sin(ea);
    const x3=cx+r2*Math.cos(ea),y3=cy+r2*Math.sin(ea),x4=cx+r2*Math.cos(sa),y4=cy+r2*Math.sin(sa);
    const lg=sweep>Math.PI?1:0;
    return {...item,d:`M${x1},${y1} A${r},${r} 0 ${lg} 1 ${x2},${y2} L${x3},${y3} A${r2},${r2} 0 ${lg} 0 ${x4},${y4} Z`,pct:((item.val/total)*100).toFixed(0)};
  });
  return (
    <div style={{display:"flex",alignItems:"center",gap:14}}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcs.map((a,i)=><path key={i} d={a.d} fill={a.color} opacity={0.85} stroke={C.card} strokeWidth={1.5}/>)}
        <text x={cx} y={cy-4} textAnchor="middle" fill={C.text} fontSize={13} fontWeight={700} fontFamily="monospace">{fmt(total)}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill={C.textDim} fontSize={8.5}>total spend</text>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {arcs.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
            <div style={{width:7,height:7,borderRadius:2,background:a.color,flexShrink:0}}/>
            <span style={{color:C.textMid,minWidth:48}}>{a.label}</span>
            <span style={{color:C.text,fontFamily:"monospace",fontWeight:600}}>{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SpendDonut;
