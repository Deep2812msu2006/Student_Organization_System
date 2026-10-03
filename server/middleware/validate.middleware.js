import { HttpError } from '../utils/httpError.js';
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    if (typeof schema?.validate === 'function') {
      const { error, value } = schema.validate(req[source], { abortEarly: false, convert: true });
      if (error) {
        const fields = Object.fromEntries(
          error.details.map(issue => [issue.path.join('.') || 'form', issue.message])
        );
        return next(new HttpError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', fields));
      }
      req.validated = value;
      return next();
    }
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = Object.fromEntries(result.error.issues.map(issue => [issue.path.join('.') || 'form', issue.message]));
      return next(new HttpError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', fields));
    }
    req.validated = result.data;
    next();
  };
}
