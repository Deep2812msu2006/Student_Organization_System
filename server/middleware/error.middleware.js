export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

export function errorHandler(error, _req, res, _next) {
  if (error.status && error.code && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({error:{code:error.code,message:error.message,...(error.fields ? {fields:error.fields} : {})}});
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the allowed size.' } });
  }
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
}
