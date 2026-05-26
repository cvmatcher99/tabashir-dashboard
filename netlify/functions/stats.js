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
  // ── Auth check ────────────────────────────────────────────────────────
  const auth  = (event.headers && event.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const client = new Client(DB);
  try {
    await client.connect();

    const today     = new Date().toISOString().split('T')[0];
    const weekAgo   = new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    const [
      totalClients,
      todayClients,
      weekClients,
      monthClients,
      totalJobs,
      perDay,
      byGender,
      byNationality,
      latestClients,
      latestJobs,
      byLocation,
    ] = await Promise.all([
      client.query('SELECT COUNT(*) FROM clients'),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) = $1", [today]),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) >= $1", [weekAgo]),
      client.query("SELECT COUNT(*) FROM clients WHERE SUBSTR(date_in,1,10) >= $1", [monthStart]),
      client.query('SELECT COUNT(*) FROM jobs'),

      // clients per day last 30 days (normalise date_in to YYYY-MM-DD)
      client.query(`
        SELECT SUBSTR(date_in, 1, 10) AS day, COUNT(*) AS cnt
        FROM clients
        WHERE SUBSTR(date_in, 1, 10) >= $1
        GROUP BY SUBSTR(date_in, 1, 10) ORDER BY day ASC
      `, [new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]]),

      // by gender — normalise to Male / Female only
      client.query(`
        SELECT
          CASE
            WHEN LOWER(TRIM(gender)) IN ('male','m') THEN 'Male'
            WHEN LOWER(TRIM(gender)) IN ('female','f') THEN 'Female'
          END AS label,
          COUNT(*) AS cnt
        FROM clients
        WHERE LOWER(TRIM(COALESCE(gender,''))) IN ('male','m','female','f')
        GROUP BY label
        ORDER BY cnt DESC
      `),

      // top 10 nationalities — normalise common variants
      client.query(`
        SELECT
          CASE
            WHEN LOWER(TRIM(nationality)) IN ('emirati','emarati','uae','united arab emirates','u.a.e','emirate','ae') THEN 'Emirati'
            WHEN LOWER(TRIM(nationality)) IN ('sudanese','sudan')        THEN 'Sudanese'
            WHEN LOWER(TRIM(nationality)) IN ('egyptian','egypt')        THEN 'Egyptian'
            WHEN LOWER(TRIM(nationality)) IN ('syrian','syria')          THEN 'Syrian'
            WHEN LOWER(TRIM(nationality)) IN ('jordanian','jordan')      THEN 'Jordanian'
            WHEN LOWER(TRIM(nationality)) IN ('yemeni','yemen')          THEN 'Yemeni'
            WHEN LOWER(TRIM(nationality)) IN ('lebanese','lebanon')      THEN 'Lebanese'
            WHEN LOWER(TRIM(nationality)) IN ('pakistani','pakistan')    THEN 'Pakistani'
            WHEN LOWER(TRIM(nationality)) IN ('indian','india')          THEN 'Indian'
            WHEN TRIM(COALESCE(nationality,'')) = '' OR LOWER(TRIM(nationality)) IN ('unknown','any','n/a') THEN NULL
            ELSE INITCAP(TRIM(nationality))
          END AS label,
          COUNT(*) AS cnt
        FROM clients
        WHERE TRIM(COALESCE(nationality,'')) != ''
          AND LOWER(TRIM(nationality)) NOT IN ('unknown','any','n/a')
        GROUP BY label
        ORDER BY cnt DESC
        LIMIT 10
      `),

      // latest 10 clients
      client.query(`
        SELECT id, name, email, phone_number, nationality, gender, date_in
        FROM clients ORDER BY date_in DESC, id DESC LIMIT 10
      `),

      // latest 10 jobs
      client.query(`
        SELECT id, job_title, COALESCE(company_name, entity, '') AS company,
               source, job_date
        FROM jobs ORDER BY job_date DESC, id DESC LIMIT 10
      `),

      // top locations
      client.query(`
        SELECT TRIM(unnest(string_to_array(location, ','))) AS loc, COUNT(*) AS cnt
        FROM clients WHERE location IS NOT NULL AND location <> ''
        GROUP BY loc ORDER BY cnt DESC LIMIT 8
      `),
    ]);

    const body = {
      summary: {
        totalClients:  parseInt(totalClients.rows[0].count),
        todayClients:  parseInt(todayClients.rows[0].count),
        weekClients:   parseInt(weekClients.rows[0].count),
        monthClients:  parseInt(monthClients.rows[0].count),
        totalJobs:     parseInt(totalJobs.rows[0].count),
      },
      charts: {
        perDay:        perDay.rows.map(r => ({ day: r.day, cnt: parseInt(r.cnt) })),
        byGender:      byGender.rows.map(r => ({ label: r.label, cnt: parseInt(r.cnt) })),
        byNationality: byNationality.rows.map(r => ({ label: r.label, cnt: parseInt(r.cnt) })),
        byLocation:    byLocation.rows.map(r => ({ label: r.loc, cnt: parseInt(r.cnt) })),
      },
      latestClients: latestClients.rows,
      latestJobs:    latestJobs.rows,
      updatedAt:     new Date().toISOString(),
    };

    return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end().catch(() => {});
  }
};
