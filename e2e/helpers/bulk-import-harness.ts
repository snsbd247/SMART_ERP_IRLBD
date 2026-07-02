/**
 * Static HTML harness that mirrors BulkImportDialog contract:
 *  - file input (accepts .csv)
 *  - preview table rows with row# + status + inline error
 *  - "Import N rows" button
 *  - progress region with data-testid="bulk-import-progress"
 *  - cancel button data-testid="bulk-import-cancel"
 *  - "Download Errors CSV" button after run
 *
 * Simulates server side by rejecting rows whose first cell contains the
 * substring passed via ?reject=<substr>. Chunk size is 2 to make cancel
 * mid-run observable in tests.
 */
export const BULK_HARNESS_HTML = `
<!doctype html><html><body>
<style>
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #ccc;padding:4px 8px;font:12px sans-serif}
  .err{color:#b00020}
  .ok{color:#0a7f2e}
</style>

<input type="file" id="file" accept=".csv,text/csv" />
<div id="counts"></div>
<table id="preview"><thead></thead><tbody></tbody></table>
<button id="import" style="display:none">Import 0 rows</button>

<div id="progress-wrap" data-testid="bulk-import-progress" style="display:none">
  <span id="progress-text"></span>
  <button data-testid="bulk-import-cancel" id="cancel">Cancel</button>
</div>

<div id="result" style="display:none">
  <span id="result-summary"></span>
  <button id="download-errors">Download Errors CSV</button>
</div>

<script>
(() => {
  const REQUIRED_MARK = /\\s*\\*$/;
  const params = new URLSearchParams(location.search);
  const rejectSubstr = params.get("reject") || "";
  const chunkSize = parseInt(params.get("chunk") || "2", 10);
  const chunkDelayMs = parseInt(params.get("delay") || "60", 10);

  const state = { headers: [], required: [], parsed: [], errors: [], cancelled: false };

  function splitCsv(text) {
    const rows = [];
    let cur = [], f = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i+1] === '"') { f += '"'; i++; }
        else if (c === '"') inQ = false;
        else f += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { cur.push(f); f = ""; }
        else if (c === "\\n") { cur.push(f); rows.push(cur); cur = []; f = ""; }
        else if (c === "\\r") {}
        else f += c;
      }
    }
    if (f.length || cur.length) { cur.push(f); rows.push(cur); }
    return rows.filter(r => r.some(v => v.trim() !== ""));
  }

  function renderPreview() {
    const thead = document.querySelector("#preview thead");
    const tbody = document.querySelector("#preview tbody");
    thead.innerHTML = "<tr><th>Row</th>" + state.headers.map(h => "<th>"+h+"</th>").join("") + "<th>Status</th></tr>";
    tbody.innerHTML = state.parsed.map(r => {
      const status = r.error
        ? '<span class="err">' + r.error + '</span>'
        : '<span class="ok">OK</span>';
      return "<tr>" +
        "<td>" + r.rowNum + "</td>" +
        state.headers.map((_, i) => "<td>" + (r.raw[i] || "-") + "</td>").join("") +
        "<td>" + status + "</td></tr>";
    }).join("");
    const valid = state.parsed.filter(r => !r.error).length;
    const invalid = state.parsed.length - valid;
    document.getElementById("counts").textContent = valid + " valid, " + invalid + " invalid";
    const btn = document.getElementById("import");
    btn.textContent = "Import " + valid + " row" + (valid === 1 ? "" : "s");
    btn.style.display = valid > 0 ? "" : "none";
  }

  document.getElementById("file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const grid = splitCsv(text);
    if (grid.length < 2) return;
    state.headers = grid[0].map(h => h.trim().replace(REQUIRED_MARK, ""));
    state.required = grid[0].map(h => /\\*\\s*$/.test(h.trim()));
    state.parsed = grid.slice(1).map((cols, idx) => {
      const row = { rowNum: idx + 2, raw: cols, error: null };
      state.headers.forEach((h, i) => {
        if (state.required[i] && !(cols[i] || "").trim()) {
          row.error = h + " is required";
        }
      });
      return row;
    });
    state.errors = state.parsed.filter(r => r.error);
    renderPreview();
  });

  document.getElementById("cancel").addEventListener("click", () => {
    state.cancelled = true;
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  document.getElementById("import").addEventListener("click", async () => {
    const valid = state.parsed.filter(r => !r.error);
    if (!valid.length) return;
    document.getElementById("import").style.display = "none";
    const wrap = document.getElementById("progress-wrap");
    const text = document.getElementById("progress-text");
    wrap.style.display = "";
    let ok = 0;
    state.cancelled = false;
    for (let i = 0; i < valid.length; i += chunkSize) {
      if (state.cancelled) break;
      const chunk = valid.slice(i, i + chunkSize);
      await sleep(chunkDelayMs);
      for (const r of chunk) {
        if (rejectSubstr && (r.raw[0] || "").includes(rejectSubstr)) {
          state.errors.push({ ...r, error: "Server rejected: matches '" + rejectSubstr + "'" });
        } else {
          ok++;
        }
      }
      const done = Math.min(i + chunk.length, valid.length);
      text.textContent = "Importing " + done + " / " + valid.length + " (" + Math.round(done*100/valid.length) + "%)";
    }
    wrap.style.display = "none";
    const res = document.getElementById("result");
    res.style.display = "";
    document.getElementById("result-summary").textContent =
      ok + " imported, " + state.errors.length + " failed" + (state.cancelled ? " (cancelled)" : "");
    document.getElementById("download-errors").style.display = state.errors.length ? "" : "none";
  });

  document.getElementById("download-errors").addEventListener("click", () => {
    const headers = [...state.headers, "Row #", "Error"];
    const escape = v => /[",\\n]/.test(String(v ?? "")) ? '"' + String(v).replace(/"/g,'""') + '"' : String(v ?? "");
    const rows = state.errors.map(r => [...state.headers.map((_, i) => r.raw[i] || ""), String(r.rowNum), r.error]);
    const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "errors.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
</script>
</body></html>`;
