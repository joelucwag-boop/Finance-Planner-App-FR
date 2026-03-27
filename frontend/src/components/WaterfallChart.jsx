import { C, fmt, Y, SPEND_CAT } from '../constants.js';

const WaterfallChart = ({year}) => {
  const yd = Y.find(d => d.yr === year);
  if (!yd) return null;
  const sc = SPEND_CAT[year];

  const steps = [];
  if (sc) {
    steps.push({label:"Gross Income",val:yd.gross,type:"start"});
    steps.push({label:"Taxes",val:-yd.tax,type:"flow"});
    if (sc.housing>500) steps.push({label:"Housing",val:-sc.housing,type:"flow"});
    if (sc.health>500) steps.push({label:"Health",val:-sc.health,type:"flow"});
    if (sc.kids>500) steps.push({label:"Kids",val:-sc.kids,type:"flow"});
    if (sc.car>500) steps.push({label:"Cars",val:-sc.car,type:"flow"});
    if (sc.bills>500) steps.push({label:"Bills",val:-sc.bills,type:"flow"});
    if (sc.debt>500) steps.push({label:"Debt Pmts",val:-sc.debt,type:"flow"});
    steps.push({label:"Leftover",val:null,type:"end"});
  } else {
    steps.push({label:"Gross",val:yd.gross,type:"start"});
    steps.push({label:"Taxes",val:-yd.tax,type:"flow"});
    steps.push({label:"Take-Home",val:null,type:"subtotal"});
    steps.push({label:"Spending",val:-yd.spend,type:"flow"});
    steps.push({label:"Leftover",val:null,type:"end"});
  }

  let running = 0;
  const bars = steps.map(s => {
    let top,bottom,color;
    if (s.type==="start") { running=s.val; top=s.val; bottom=0; color=C.green; }
    else if (s.type==="subtotal") { top=running; bottom=0; color=C.blue; }
    else if (s.type==="end") { top=Math.max(running,0); bottom=Math.min(running,0); color=running>=0?C.green:C.red; }
    else { const prev=running; running+=s.val; top=Math.max(prev,running); bottom=Math.min(prev,running); color=s.val>=0?C.green:C.red; }
    return {...s,top,bottom,running,color};
  });

  const W=700,H=360,pad={t:30,r:15,b:60,l:60};
  const cw=W-pad.l-pad.r, ch=H-pad.t-pad.b, n=bars.length;
  const barW=Math.min(55,(cw/n)*0.6), gap=(cw-barW*n)/(n+1);
  const allV=bars.flatMap(b=>[b.top,b.bottom]);
  const yMax=Math.max(...allV)*1.12, yMin=Math.min(...allV,0)*1.05, yR=yMax-yMin||1;
  const sy=v => pad.t+ch*(1-(v-yMin)/yR);

  const yTicks = [];
  let step = Math.pow(10,Math.floor(Math.log10(yR)));
  if (yR/step<3) step/=2; if (yR/step>8) step*=2;
  for (let v=Math.ceil(yMin/step)*step; v<=yMax; v+=step) yTicks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
      <defs>
        <linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></linearGradient>
        <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171"/><stop offset="100%" stopColor="#dc2626"/></linearGradient>
        <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#2563eb"/></linearGradient>
      </defs>
      {yTicks.map((v,i)=>(<g key={i}><line x1={pad.l} y1={sy(v)} x2={W-pad.r} y2={sy(v)} stroke={C.border} strokeWidth={0.5}/>
        <text x={pad.l-8} y={sy(v)+4} textAnchor="end" fill={C.textDim} fontSize={10} fontFamily="monospace">{fmt(v)}</text></g>))}
      <line x1={pad.l} y1={sy(0)} x2={W-pad.r} y2={sy(0)} stroke={C.borderLight} strokeWidth={1}/>
      {bars.map((bar,i) => {
        if (i>=bars.length-1||bar.type==="subtotal") return null;
        const x1=pad.l+gap*(i+1)+barW*i+barW, x2=pad.l+gap*(i+2)+barW*(i+1);
        return <line key={`c${i}`} x1={x1} y1={sy(bar.running)} x2={x2} y2={sy(bar.running)} stroke={C.textDim} strokeWidth={1} strokeDasharray="4,3" opacity={0.5}/>;
      })}
      {bars.map((bar,i) => {
        const x=pad.l+gap*(i+1)+barW*i;
        const yTop=sy(bar.top), yBot=sy(bar.bottom), h=Math.max(yBot-yTop,1);
        const gid = bar.color===C.green?"url(#gG)":bar.color===C.red?"url(#gR)":"url(#gB)";
        const dv = bar.type==="end"||bar.type==="subtotal"?bar.running:bar.val;
        return (<g key={i}>
          <rect x={x} y={yTop} width={barW} height={h} rx={3} fill={gid} opacity={0.9}/>
          <text x={x+barW/2} y={dv>=0?yTop-7:yBot+13} textAnchor="middle" fill={C.text} fontSize={10} fontFamily="monospace" fontWeight={bar.type==="end"?700:500}>{fmt(dv)}</text>
          <text x={x+barW/2} y={H-pad.b+14} textAnchor="end" fill={C.textMid} fontSize={9.5}
            transform={`rotate(-35,${x+barW/2},${H-pad.b+14})`}>{bar.label}</text>
        </g>);
      })}
    </svg>
  );
};

export default WaterfallChart;
