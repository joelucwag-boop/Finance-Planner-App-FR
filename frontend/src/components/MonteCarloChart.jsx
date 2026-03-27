import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { C, fmt, fmtFull } from '../constants.js';

const MonteCarloChart = ({data}) => {
  if (!data?.years) return null;

  // Build chart data: year + deterministic + percentile bands
  const chartData = data.years.map((yr, i) => ({
    yr,
    det: data.deterministic.nw[i],
    p10: data.percentiles.p10.nw[i],
    p25: data.percentiles.p25.nw[i],
    p50: data.percentiles.p50.nw[i],
    p75: data.percentiles.p75.nw[i],
    p90: data.percentiles.p90.nw[i],
  }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <AreaChart data={chartData} margin={{top:10,right:10,left:10,bottom:5}}>
        <defs>
          <linearGradient id="mcBand90" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.08}/>
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02}/>
          </linearGradient>
          <linearGradient id="mcBand75" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15}/>
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.04}/>
          </linearGradient>
          <linearGradient id="mcBand50" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25}/>
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.06}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
        <XAxis dataKey="yr" tick={{fill:C.textDim,fontSize:10}} tickLine={false} interval={4}/>
        <YAxis tick={{fill:C.textDim,fontSize:10}} tickLine={false} tickFormatter={v=>fmt(v)} width={55}/>
        <Tooltip
          contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontFamily:"monospace",fontSize:11}}
          labelStyle={{color:C.text,fontWeight:700}}
          formatter={(v,n) => {
            const labels = {p90:"P90 (optimistic)",p75:"P75",p50:"P50 (median)",p25:"P25",p10:"P10 (pessimistic)",det:"Your plan"};
            return [fmtFull(v), labels[n]||n];
          }}
        />
        {/* P10-P90 band (widest, lightest) */}
        <Area type="monotone" dataKey="p90" stroke="none" fill="url(#mcBand90)" />
        <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" />
        {/* P25-P75 band (middle) */}
        <Area type="monotone" dataKey="p75" stroke="none" fill="url(#mcBand75)" />
        <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" />
        {/* P50 median line */}
        <Area type="monotone" dataKey="p50" stroke="#22c55e" fill="none" strokeWidth={2} strokeDasharray="6 3" />
        {/* Deterministic plan line (solid blue) */}
        <Area type="monotone" dataKey="det" stroke="#3b82f6" fill="none" strokeWidth={2.5} />
        {/* P10 pessimistic line */}
        <Area type="monotone" dataKey="p10" stroke="#ef4444" fill="none" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.6} />
        {/* P90 optimistic line */}
        <Area type="monotone" dataKey="p90" stroke="#22c55e" fill="none" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.6} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default MonteCarloChart;
