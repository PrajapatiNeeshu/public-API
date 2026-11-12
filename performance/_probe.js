import http from "k6/http";
export const options = { vus: 1, iterations: 1, insecureSkipTLSVerify: true, tlsVersion: { min: "tls1.2", max: "tls1.2" }, noConnectionReuse: true };
export default function () {
  const res = http.get("https://imssit.indiapost.gov.in/bepliagent/v1/agent-types", {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Connection: "close",
    },
  });
  console.log("status=" + res.status);
  console.log("error=" + res.error);
  console.log("body=" + String(res.body).slice(0, 250));
}
