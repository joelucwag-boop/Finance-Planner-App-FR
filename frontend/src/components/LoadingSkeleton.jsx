const C = {
  card:"#0c1220", border:"#1a2540", textDim:"#64748b", bg:"#060a13",
};

const pulse = `
@keyframes skeletonPulse {
  0% { opacity: 0.4; }
  50% { opacity: 0.7; }
  100% { opacity: 0.4; }
}
`;

const LoadingSkeleton = ({ type = "chart", message }) => {
  if (type === "chart") {
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: "14px 10px 8px", marginBottom: 14, textAlign: "center",
      }}>
        <style>{pulse}</style>
        <div style={{
          height: 200, background: C.bg, borderRadius: 8,
          animation: "skeletonPulse 1.5s ease-in-out infinite",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 12, color: C.textDim }}>
            {message || "Loading..."}
          </span>
        </div>
      </div>
    );
  }

  if (type === "metrics") {
    return (
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <style>{pulse}</style>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            flex: "1 1 140px", height: 72, background: C.card,
            border: `1px solid ${C.border}`, borderRadius: 12,
            animation: "skeletonPulse 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }} />
        ))}
      </div>
    );
  }

  // type === "inline"
  return (
    <div style={{
      padding: "40px 0", textAlign: "center",
      animation: "skeletonPulse 1.5s ease-in-out infinite",
    }}>
      <style>{pulse}</style>
      <span style={{ fontSize: 12, color: C.textDim }}>
        {message || "Loading..."}
      </span>
    </div>
  );
};

export default LoadingSkeleton;
