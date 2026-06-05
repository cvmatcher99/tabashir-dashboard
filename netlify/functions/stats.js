const { Client } = require('pg');
const jwt        = require('jsonwebtoken');

const DB = {
  host:     '77.243.85.225',
  port:     5432,
  database: 'tabashir',
  user:     'postgres',
  password: 'tabashir2025',
  ssl:      false,
  connectionTimeoutMillis: 8000,
};

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  const auth  = (event.headers && event.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try { jwt.verify(token, process.env.JWT_SECRET); }
  catch { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) }; }

  const client = new Client(DB);
  try {
    await client.connect();
    const today      = new Date().toISOString().split('T')[0];
    const weekAgo    = new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    const [
      totalClients, todayClients, weekClients, monthClients, totalJobs,
      perDay, byGender, byNationality, latestClients, latestJobs,
      byLocation, clientApps, manualSummary, employeeStats,
    ] = await Promise.all([
      client.query('SELECT COUNT(*) FROM clients'),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) = $1", [today]),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) >= $1", [weekAgo]),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) >= $1", [monthStart]),
      client.query('SELECT COUNT(*) FROM jobs'),

      client.query(`
        SELECT SUBSTR(date_in, 1, 10) AS day, COUNT(*) AS cnt
        FROM clients WHERE SUBSTR(date_in, 1, 10) >= $1
        GROUP BY SUBSTR(date_in, 1, 10) ORDER BY day ASC
      `, [new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]]),

      client.query(`
        SELECT
          CASE WHEN LOWER(TRIM(gender)) IN ('male','m') THEN 'Male'
               WHEN LOWER(TRIM(gender)) IN ('female','f') THEN 'Female' END AS label,
          COUNT(*) AS cnt
        FROM clients
        WHERE LOWER(TRIM(COALESCE(gender,''))) IN ('male','m','female','f')
        GROUP BY label ORDER BY cnt DESC
      `),

      client.query(`
        SELECT
          CASE
            WHEN LOWER(TRIM(nationality)) IN ('emirati','emarati','uae','united arab emirates','u.a.e','emirate','ae') THEN 'Emirati'
            WHEN LOWER(TRIM(nationality)) IN ('sudanese','sudan')     THEN 'Sudanese'
            WHEN LOWER(TRIM(nationality)) IN ('egyptian','egypt')     THEN 'Egyptian'
            WHEN LOWER(TRIM(nationality)) IN ('syrian','syria')       THEN 'Syrian'
            WHEN LOWER(TRIM(nationality)) IN ('jordanian','jordan')   THEN 'Jordanian'
            WHEN LOWER(TRIM(nationality)) IN ('yemeni','yemen')       THEN 'Yemeni'
            WHEN LOWER(TRIM(nationality)) IN ('lebanese','lebanon')   THEN 'Lebanese'
            WHEN LOWER(TRIM(nationality)) IN ('pakistani','pakistan') THEN 'Pakistani'
            WHEN LOWER(TRIM(nationality)) IN ('indian','india')       THEN 'Indian'
            WHEN TRIM(COALESCE(nationality,'')) = '' OR LOWER(TRIM(nationality)) IN ('unknown','any','n/a') THEN NULL
            ELSE INITCAP(TRIM(nationality))
          END AS label, COUNT(*) AS cnt
        FROM clients
        WHERE TRIM(COALESCE(nationality,'')) != '' AND LOWER(TRIM(nationality)) NOT IN ('unknown','any','n/a')
        GROUP BY label ORDER BY cnt DESC LIMIT 10
      `),

      client.query(`
        SELECT id, name, email, phone_number, nationality, gender, date_in
        FROM clients ORDER BY date_in DESC, id DESC LIMIT 30
      `),

      client.query(`
        SELECT id, job_title, COALESCE(company_name, entity, '') AS company, source, job_date
        FROM jobs ORDER BY job_date DESC, id DESC LIMIT 10
      `),

      client.query(`
        SELECT TRIM(unnest(string_to_array(location, ','))) AS loc, COUNT(*) AS cnt
        FROM clients WHERE location IS NOT NULL AND location <> ''
        GROUP BY loc ORDER BY cnt DESC LIMIT 8
      `),

      client.query(`
        SELECT c.id, c.name, c.email, c.nationality,
               COALESCE(c.jobs_to_apply_number, 0)                         AS total_jobs,
               COALESCE(c.manual_quota, 0)                                  AS manual_quota,
               COUNT(ma.id)                                                 AS manual_count,
               COUNT(r.id) FILTER (WHERE r.status = 'applied')             AS auto_count
        FROM clients c
        LEFT JOIN manual_applications ma ON ma.client_id = c.id
        LEFT JOIN rankings r             ON r.client_id  = c.id::text
        WHERE COALESCE(c.client_type, 'fresh') = 'fresh'
        GROUP BY c.id, c.name, c.email, c.nationality, c.jobs_to_apply_number, c.manual_quota
        ORDER BY (COALESCE(c.manual_quota,0) + COUNT(ma.id)) DESC
        LIMIT 100
      `),

      client.query(`
        SELECT COUNT(*)                                           AS total,
               COUNT(*) FILTER (WHERE status = 'Applied')        AS applied,
               COUNT(*) FILTER (WHERE status = 'Pending')        AS pending,
               COUNT(*) FILTER (WHERE status = 'Rejected')       AS rejected,
               COUNT(*) FILTER (WHERE status = 'Interview')      AS interview
        FROM manual_applications
      `),

      client.query(`
        SELECT
          applied_by,
          COUNT(*) FILTER (WHERE app_date = CURRENT_DATE)                             AS today,
          COUNT(*) FILTER (WHERE app_date >= CURRENT_DATE - INTERVAL '6 days')        AS week,
          COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)) AS month,
          COUNT(*)                                                                     AS total
        FROM manual_applications
        WHERE applied_by IN ('AMIRA','RAHMA','RAWAN')
        GROUP BY applied_by
        ORDER BY applied_by
      `),
    ]);

    const ms = manualSummary.rows[0];
    const body = {
      summary: {
        totalClients:    parseInt(totalClients.rows[0].count),
        todayClients:    parseInt(todayClients.rows[0].count),
        weekClients:     parseInt(weekClients.rows[0].count),
        monthClients:    parseInt(monthClients.rows[0].count),
        totalJobs:       parseInt(totalJobs.rows[0].count),
        totalManual:     parseInt(ms.total),
        manualApplied:   parseInt(ms.applied),
        manualPending:   parseInt(ms.pending),
        manualRejected:  parseInt(ms.rejected),
        manualInterview: parseInt(ms.interview),
      },
      charts: {
        perDay:        perDay.rows.map(r => ({ day: r.day, cnt: parseInt(r.cnt) })),
        byGender:      byGender.rows.map(r => ({ label: r.label, cnt: parseInt(r.cnt) })),
        byNationality: byNationality.rows.map(r => ({ label: r.label, cnt: parseInt(r.cnt) })),
        byLocation:    byLocation.rows.map(r => ({ label: r.loc, cnt: parseInt(r.cnt) })),
      },
      latestClients: latestClients.rows,
      latestJobs:    latestJobs.rows,
      clientApplications: clientApps.rows.map(r => ({
        id:          parseInt(r.id),
        name:        r.name,
        email:       r.email,
        nationality: r.nationality,
        totalJobs:   parseInt(r.total_jobs),
        manualQuota: parseInt(r.manual_quota),
        autoQuota:   parseInt(r.total_jobs) - parseInt(r.manual_quota),
        manualCount: parseInt(r.manual_count),
        autoCount:   parseInt(r.auto_count),
      })),
      employeeStats: employeeStats.rows.map(r => ({
        name:  r.applied_by,
        today: parseInt(r.today),
        week:  parseInt(r.week),
        month: parseInt(r.month),
        total: parseInt(r.total),
      })),
      updatedAt: new Date().toISOString(),
    };

    return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end().catch(() => {});
  }
};