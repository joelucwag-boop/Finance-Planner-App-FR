import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { C, fmt, fmtFull, Y } from '../constants.js';

const IncomeSpendChart = () => {
  const data = Y.filter((_,i)=>i%2===0||i<10).map(d=>({yr:d.yr,income:d.take,spend:d.spend}));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{top:10,right:10,left:10,bottom:5}}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
        <XAxis dataKey="yr" tick={{fill:C.textDim,fontSize:10}} tickLine={false} interval={3}/>
        <YAxis tick={{fill:C.textDim,fontSize:10}} tickLine={false} tickFormatter={v=>fmt(v)} width={50}/>
        <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontFamily:"monospace",fontSize:12}}
          labelStyle={{color:C.text,fontWeight:700}} formatter={(v,n)=>[fmtFull(v),n==="income"?"Take-Home":"Spending"]}/>
        <Area type="monotone" dataKey="income" stroke={C.green} fill={C.greenGlow} strokeWidth={2}/>
        <Area type="monotone" dataKey="spend" stroke={C.red} fill={C.redGlow} strokeWidth={2}/>
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default IncomeSpendChart;
