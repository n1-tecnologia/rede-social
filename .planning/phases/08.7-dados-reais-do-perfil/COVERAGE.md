No external API integration: the phase reads its own Postgres rows through its own Hono API, a nightly pg-boss job and SECURITY DEFINER functions; no third-party API, SDK or webhook is added.
