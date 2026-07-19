"""
Generates docs/index.html for tabashir-dashboard as a static GitHub Pages site.
Run: python build_dash.py
"""
import json, os
import psycopg2, psycopg2.extras
from datetime import datetime, date, timedelta

DB = dict(host="77.243.85.225", database="tabashir",
          user="postgres", password="tabashir2025", connect_timeout=8)

conn = psycopg2.connect(**DB, cursor_factory=psycopg2.extras.RealDictCursor)
cur  = conn.cursor()

today       = date.today().isoformat()
week_ago    = (date.today() - timedelta(days=7)).isoformat()
month_start = date.today().strftime("%Y-%m-01")
month_30    = (date.today() - timedelta(days=30)).isoformat()

# Summary
cur.execute("SELECT COUNT(*) AS n FROM clients")
tc = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM clients WHERE SUBSTR(date_in,1,10) = %s", [today])
td = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM clients WHERE SUBSTR(date_in,1,10) >= %s", [week_ago])
tw = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM clients WHERE SUBSTR(date_in,1,10) >= %s", [month_start])
tm = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM jobs")
tj = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM manual_applications")
tma = int(cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM manual_applications WHERE app_date = CURRENT_DATE")
tma_today = int(cur.fetchone()["n"])

# Per day (last 30 days)
cur.execute("""
    SELECT SUBSTR(date_in,1,10) AS day, COUNT(*) AS cnt
    FROM clients WHERE SUBSTR(date_in,1,10) >= %s
    GROUP BY SUBSTR(date_in,1,10) ORDER BY day ASC
""", [month_30])
per_day = [dict(r) for r in cur.fetchall()]

# By gender
cur.execute("""
    SELECT
      CASE WHEN LOWER(TRIM(gender)) IN ('male','m') THEN 'Male'
           WHEN LOWER(TRIM(gender)) IN ('female','f') THEN 'Female' END AS label,
      COUNT(*) AS cnt
    FROM clients
    WHERE LOWER(TRIM(COALESCE(gender,''))) IN ('male','m','female','f')
    GROUP BY label ORDER BY cnt DESC
""")
by_gender = [dict(r) for r in cur.fetchall()]

# By nationality (top 10)
cur.execute("""
    SELECT
      CASE
        WHEN LOWER(TRIM(nationality)) IN ('emirati','emarati','uae','united arab emirates','u.a.e','emirate','ae') THEN 'Emirati'
        WHEN LOWER(TRIM(nationality)) IN ('sudanese','sudan') THEN 'Sudanese'
        WHEN LOWER(TRIM(nationality)) IN ('egyptian','egypt') THEN 'Egyptian'
        WHEN LOWER(TRIM(nationality)) IN ('syrian','syria')   THEN 'Syrian'
        WHEN LOWER(TRIM(nationality)) IN ('jordanian','jordan') THEN 'Jordanian'
        WHEN LOWER(TRIM(nationality)) IN ('yemeni','yemen')   THEN 'Yemeni'
        WHEN LOWER(TRIM(nationality)) IN ('lebanese','lebanon') THEN 'Lebanese'
        WHEN LOWER(TRIM(nationality)) IN ('pakistani','pakistan') THEN 'Pakistani'
        WHEN LOWER(TRIM(nationality)) IN ('indian','india')   THEN 'Indian'
        ELSE INITCAP(TRIM(nationality))
      END AS label, COUNT(*) AS cnt
    FROM clients
    WHERE TRIM(COALESCE(nationality,'')) != '' AND LOWER(TRIM(nationality)) NOT IN ('unknown','any','n/a','')
    GROUP BY label ORDER BY cnt DESC LIMIT 10
""")
by_nationality = [dict(r) for r in cur.fetchall()]

# Employee (manual apply) stats
cur.execute("""
    SELECT
      applied_by,
      COUNT(*) FILTER (WHERE app_date = CURRENT_DATE)                              AS today,
      COUNT(*) FILTER (WHERE app_date >= CURRENT_DATE - INTERVAL '6 days')         AS week,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month',created_at)=DATE_TRUNC('month',CURRENT_DATE)) AS month,
      COUNT(*)                                                                      AS total
    FROM manual_applications
    WHERE applied_by IN ('AMIRA','RAHMA','RAWAN')
    GROUP BY applied_by ORDER BY applied_by
""")
emp_stats = [dict(r) for r in cur.fetchall()]

# Staff stats
cur.execute("""
    SELECT
      'ZAINAB' AS role,
      COUNT(*) FILTER (WHERE SUBSTR(date_in,1,10) = %s) AS today,
      COUNT(*) FILTER (WHERE SUBSTR(date_in,1,10) >= %s) AS week,
      COUNT(*) FILTER (WHERE SUBSTR(date_in,1,10) >= %s) AS month,
      COUNT(*) AS total
    FROM clients
    UNION ALL
    SELECT
      'FATMA',
      COUNT(*) FILTER (WHERE job_date::text = %s),
      COUNT(*) FILTER (WHERE job_date::text >= %s),
      COUNT(*) FILTER (WHERE job_date::text >= %s),
      COUNT(*)
    FROM jobs
""", [today, week_ago, month_start, today, week_ago, month_start])
staff_stats = [dict(r) for r in cur.fetchall()]

# Latest clients
cur.execute("""
    SELECT id, name, email, phone_number, nationality, gender, date_in
    FROM clients ORDER BY date_in DESC, id DESC LIMIT 30
""")
latest_clients = [dict(r) for r in cur.fetchall()]

# Latest jobs
cur.execute("""
    SELECT id, job_title, COALESCE(company_name, entity, '') AS company, source, job_date
    FROM jobs ORDER BY job_date DESC, id DESC LIMIT 10
""")
latest_jobs = [dict(r) for r in cur.fetchall()]

conn.close()

build_time = datetime.now().strftime("%d %b %Y, %H:%M")

data = {
    "summary": {
        "totalClients": tc, "todayClients": td, "weekClients": tw,
        "monthClients": tm, "totalJobs": tj,
        "totalManual": tma, "manualToday": tma_today,
    },
    "charts": {
        "perDay":       [{"day": r["day"], "cnt": int(r["cnt"])} for r in per_day],
        "byGender":     [{"label": r["label"], "cnt": int(r["cnt"])} for r in by_gender],
        "byNationality":[{"label": r["label"], "cnt": int(r["cnt"])} for r in by_nationality],
    },
    "latestClients": [
        {"id": r["id"], "name": r["name"], "email": r.get("email",""),
         "nationality": r.get("nationality",""), "gender": r.get("gender",""),
         "dateIn": str(r.get("date_in","") or "")[:10]}
        for r in latest_clients
    ],
    "latestJobs": [
        {"id": r["id"], "title": r["job_title"],
         "company": r.get("company",""), "source": r.get("source",""),
         "date": str(r.get("job_date","") or "")[:10]}
        for r in latest_jobs
    ],
    "empStats": [
        {"name": r["applied_by"],
         "today": int(r["today"]), "week": int(r["week"]),
         "month": int(r["month"]), "total": int(r["total"])}
        for r in emp_stats
    ],
    "staffStats": [
        {"role": r["role"],
         "today": int(r["today"]), "week": int(r["week"]),
         "month": int(r["month"]), "total": int(r["total"])}
        for r in staff_stats
    ],
    "builtAt": build_time,
}

data_json = json.dumps(data, ensure_ascii=False, default=str)

# Max value for per-day bar chart
max_day = max((r["cnt"] for r in data["charts"]["perDay"]), default=1)

HTML = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Tabashir Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
:root{{
  --bg:#f0f4f8;--surface:#fff;--sf2:#f7f8fa;--border:#e5e7eb;
  --accent:#2563eb;--mint:#059669;--orange:#ea6800;--purple:#7c3aed;
  --red:#dc2626;--muted:#6b7280;--text:#111827;
}}
body{{background:var(--bg);color:var(--text);font-family:'Cairo',sans-serif;min-height:100vh}}
.top-bar{{background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.15)}}
.logo{{font-size:24px;font-weight:900;letter-spacing:-.5px}}
.sub{{font-size:13px;opacity:.8}}
.spacer{{flex:1}}
.built-badge{{background:rgba(255,255,255,.2);padding:5px 14px;border-radius:20px;font-size:12px}}
.page{{padding:20px 24px;max-width:1200px;margin:0 auto}}
.section-title{{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:24px 0 12px}}

/* KPI Cards */
.kpi-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:16px}}
.kpi-card{{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px 14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
.kpi-label{{font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}}
.kpi-value{{font-size:38px;font-weight:900;line-height:1}}

/* Tables */
.table-wrap{{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:24px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
thead tr{{background:var(--sf2);border-bottom:1px solid var(--border)}}
th{{padding:11px 14px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}}
td{{padding:11px 14px;border-bottom:1px solid var(--border)}}
tr:last-child td{{border-bottom:none}}
tr:hover td{{background:#f9fafb}}

/* Bar chart */
.bar-chart{{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:24px}}
.bar-chart-title{{font-size:13px;font-weight:700;margin-bottom:14px}}
.bars{{display:flex;align-items:flex-end;gap:3px;height:80px}}
.bar{{flex:1;min-width:4px;border-radius:4px 4px 0 0;background:var(--accent);opacity:.85;position:relative}}
.bar:hover{{opacity:1}}
.bar-tip{{display:none;position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;white-space:nowrap;z-index:10}}
.bar:hover .bar-tip{{display:block}}
.bar-labels{{display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:var(--muted)}}

/* Donut-style pills */
.pill-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:24px}}
.pill-item{{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}}
.pill-label{{font-size:13px;font-weight:700}}
.pill-val{{font-size:18px;font-weight:900;color:var(--accent)}}

/* Employee stat table badges */
.badge{{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700}}
.b-green{{background:#d1fae5;color:#065f46}}
.b-blue{{background:#dbeafe;color:#1d4ed8}}
.b-orange{{background:#ffedd5;color:#9a3412}}

@media(max-width:600px){{
  .page{{padding:12px 14px}}
  .kpi-grid{{grid-template-columns:1fr 1fr}}
  th,td{{padding:8px 10px}}
}}
</style>
</head>
<body>
<div class="top-bar">
  <div>
    <div class="logo">Tabashir</div>
    <div class="sub">Dashboard</div>
  </div>
  <div class="spacer"></div>
  <div class="built-badge">&#128197; {build_time}</div>
</div>

<div class="page">

<!-- Summary KPI -->
<div class="section-title">إحصائيات عامة</div>
<div class="kpi-grid" id="kpiGrid"></div>

<!-- Staff performance -->
<div class="section-title">أداء الموظفين — يدوي</div>
<div class="table-wrap">
<table>
  <thead><tr><th>الموظف</th><th>اليوم</th><th>الأسبوع</th><th>الشهر</th><th>الإجمالي</th></tr></thead>
  <tbody id="empBody"></tbody>
</table>
</div>

<!-- Staff (Zainab/Fatma) -->
<div class="section-title">أداء الموظفين — بيانات</div>
<div class="table-wrap">
<table>
  <thead><tr><th>الدور</th><th>اليوم</th><th>الأسبوع</th><th>الشهر</th><th>الإجمالي</th></tr></thead>
  <tbody id="staffBody"></tbody>
</table>
</div>

<!-- Per day chart -->
<div class="bar-chart">
  <div class="bar-chart-title">عملاء جدد — آخر 30 يوم</div>
  <div class="bars" id="barsEl"></div>
  <div class="bar-labels" id="barLabels"></div>
</div>

<!-- By nationality -->
<div class="section-title">الجنسيات</div>
<div class="pill-grid" id="natGrid"></div>

<!-- Latest clients -->
<div class="section-title">آخر العملاء</div>
<div class="table-wrap">
<table>
  <thead><tr><th>#</th><th>الاسم</th><th>الجنسية</th><th>الجنس</th><th>تاريخ الانضمام</th></tr></thead>
  <tbody id="clientBody"></tbody>
</table>
</div>

<!-- Latest jobs -->
<div class="section-title">آخر الوظائف</div>
<div class="table-wrap">
<table>
  <thead><tr><th>الوظيفة</th><th>الشركة</th><th>المصدر</th><th>التاريخ</th></tr></thead>
  <tbody id="jobBody"></tbody>
</table>
</div>

</div><!-- /page -->

<script>
const D = {data_json};
const MAX_DAY = {max_day};

// KPI cards
const kpiData = [
  {{label:'إجمالي العملاء', val:D.summary.totalClients, color:'#2563eb'}},
  {{label:'عملاء اليوم',    val:D.summary.todayClients, color:'#059669'}},
  {{label:'عملاء الأسبوع',  val:D.summary.weekClients,  color:'#7c3aed'}},
  {{label:'عملاء الشهر',   val:D.summary.monthClients,  color:'#ea6800'}},
  {{label:'إجمالي الوظائف', val:D.summary.totalJobs,    color:'#dc2626'}},
  {{label:'تقديمات يدوية',  val:D.summary.totalManual,   color:'#0891b2'}},
  {{label:'يدوي اليوم',     val:D.summary.manualToday,   color:'#d97706'}},
];
const kg = document.getElementById('kpiGrid');
kpiData.forEach(k=>{{
  kg.innerHTML+=`<div class="kpi-card"><div class="kpi-label">${{k.label}}</div><div class="kpi-value" style="color:${{k.color}}">${{k.val}}</div></div>`;
}});

// Employee stats
const eb = document.getElementById('empBody');
D.empStats.forEach(e=>{{
  eb.innerHTML+=`<tr>
    <td><strong>${{e.name}}</strong></td>
    <td><span class="badge b-green">${{e.today}}</span></td>
    <td><span class="badge b-blue">${{e.week}}</span></td>
    <td><span class="badge b-orange">${{e.month}}</span></td>
    <td><strong>${{e.total}}</strong></td>
  </tr>`;
}});

// Staff stats
const sb = document.getElementById('staffBody');
D.staffStats.forEach(s=>{{
  sb.innerHTML+=`<tr>
    <td><strong>${{s.role}}</strong></td>
    <td><span class="badge b-green">${{s.today}}</span></td>
    <td><span class="badge b-blue">${{s.week}}</span></td>
    <td><span class="badge b-orange">${{s.month}}</span></td>
    <td><strong>${{s.total}}</strong></td>
  </tr>`;
}});

// Bar chart
const barsEl = document.getElementById('barsEl');
const labelsEl = document.getElementById('barLabels');
D.charts.perDay.forEach((d,i)=>{{
  const pct = MAX_DAY > 0 ? Math.max(4, Math.round(d.cnt/MAX_DAY*100)) : 4;
  barsEl.innerHTML+=`<div class="bar" style="height:${{pct}}%"><div class="bar-tip">${{d.day.slice(5)}} (${{d.cnt}})</div></div>`;
}});
if(D.charts.perDay.length>0){{
  const first = D.charts.perDay[0].day.slice(5);
  const last  = D.charts.perDay[D.charts.perDay.length-1].day.slice(5);
  labelsEl.innerHTML=`<span>${{first}}</span><span>${{last}}</span>`;
}}

// Nationality pills
const ng = document.getElementById('natGrid');
D.charts.byNationality.forEach(n=>{{
  ng.innerHTML+=`<div class="pill-item"><div class="pill-label">${{n.label}}</div><div class="pill-val">${{n.cnt}}</div></div>`;
}});

// Latest clients
const cb = document.getElementById('clientBody');
D.latestClients.forEach((c,i)=>{{
  cb.innerHTML+=`<tr>
    <td style="color:var(--muted);font-size:11px">${{i+1}}</td>
    <td><strong>${{c.name}}</strong></td>
    <td>${{c.nationality||'—'}}</td>
    <td>${{c.gender||'—'}}</td>
    <td style="direction:ltr">${{c.dateIn||'—'}}</td>
  </tr>`;
}});

// Latest jobs
const jb = document.getElementById('jobBody');
D.latestJobs.forEach(j=>{{
  jb.innerHTML+=`<tr>
    <td><strong>${{j.title}}</strong></td>
    <td>${{j.company||'—'}}</td>
    <td>${{j.source||'—'}}</td>
    <td style="direction:ltr">${{j.date||'—'}}</td>
  </tr>`;
}});
</script>
</body>
</html>"""

os.makedirs("docs", exist_ok=True)
with open("docs/index.html", "w", encoding="utf-8") as f:
    f.write(HTML)
print(f"Done: docs/index.html generated — {build_time}")
print(f"  Clients: {tc} | Today: {td} | Jobs: {tj} | Manual apps: {tma}")
