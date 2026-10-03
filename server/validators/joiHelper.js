import Joi from 'joi';

/**
 * Wraps a Joi schema to provide a .safeParse(data) method for compatibility
 * with existing test assertions and route helpers.
 */
export function wrap(schema) {
  schema.safeParse = function(data) {
    const { error, value } = this.validate(data, { abortEarly: false, convert: true });
    if (error) {
      return {
        success: false,
        error: {
          issues: error.details.map(d => ({
            path: d.path,
            message: d.message,
          })),
        },
      };
    }
    return { success: true, data: value };
  };
  return schema;
}

export default Joi;
