import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { C, fmt, fmtFull, Y, BASE } from '../constants.js';

const NWTooltip = ({active,payload,label}) => {
  if (!active || !payload?.length) return null;
  const d = Y.find(y=>y.yr===label);
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
      padding:"8px 12px",fontSize:11,lineHeight:1.7,fontFamily:"monospace"}}>
      <div style={{color:C.text,fontWeight:700,marginBottom:3}}>{label} · Age {label-(BASE.birthYear||2003)}</div>
      {d && <>
        <div style={{color:C.green}}>Net Worth: {fmtFull(d.nw)}</div>
        <div style={{color:"#60a5fa"}}>Invested: {fmtFull(d.inv)}</div>
        <div style={{color:"#a78bfa"}}>Home Equity: {fmtFull(d.home-d.mort)}</div>
        <div style={{color:"#06b6d4"}}>Cash: {fmtFull(d.sn+d.sav)}</div>
        {d.debt>0 && <div style={{color:C.red}}>Debt: {fmtFull(-d.debt)}</div>}
      </>}
    </div>
  );
};

const NetWorthChart = () => {
  const data = Y.map(d => ({
    yr:d.yr, invested:d.inv, homeEquity:Math.max(0,d.home-d.mort),
    cash:d.sn+d.sav, debt:d.debt>0?-d.debt:0,
  }));
  return (
    <ResponsiveContainer width="100%" height={340}>
      <AreaChart data={data} margin={{top:10,right:10,left:10,bottom:5}}>
        <defs>
          <linearGradient id="agI" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6}/><stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05}/></linearGradient>
          <linearGradient id="agH" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5}/><stop offset="100%" stopColor="#a78bfa" stopOpacity={0.05}/></linearGradient>
          <linearGradient id="agC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.5}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05}/></linearGradient>
          <linearGradient id="agD" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#ef4444" stopOpacity={0.4}/><stop offset="100%" stopColor="#ef4444" stopOpacity={0.05}/></linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
        <XAxis dataKey="yr" tick={{fill:C.textDim,fontSize:10}} tickLine={false} interval={4}/>
        <YAxis tick={{fill:C.textDim,fontSize:10}} tickLine={false} tickFormatter={v=>fmt(v)} width={50}/>
        <Tooltip content={<NWTooltip/>}/>
        {[2027,2028,2031,2042].map(yr => <ReferenceLine key={yr} x={yr} stroke={C.borderLight} strokeDasharray="4 4"/>)}
        <Area type="monotone" dataKey="invested" stackId="1" stroke="#3b82f6" fill="url(#agI)" strokeWidth={1.5}/>
        <Area type="monotone" dataKey="homeEquity" stackId="1" stroke="#a78bfa" fill="url(#agH)" strokeWidth={1.5}/>
        <Area type="monotone" dataKey="cash" stackId="1" stroke="#06b6d4" fill="url(#agC)" strokeWidth={1.5}/>
        <Area type="monotone" dataKey="debt" stroke="#ef4444" fill="url(#agD)" strokeWidth={1.5}/>
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default NetWorthChart;
