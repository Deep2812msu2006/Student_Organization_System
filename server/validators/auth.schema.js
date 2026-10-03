import Joi, { wrap } from './joiHelper.js';

const email = Joi.string().trim().lowercase().email({ tlds: false }).max(254).required();

const password = Joi.string().min(10).custom((value, helpers) => {
  if (Buffer.byteLength(value, 'utf8') > 72) return helpers.error('password.maxBytes');
  return value;
}).required().messages({
  'string.min': 'Use at least 10 characters.',
  'password.maxBytes': 'Use no more than 72 UTF-8 bytes.',
});

const loginPassword = Joi.string().min(1).custom((value, helpers) => {
  if (Buffer.byteLength(value, 'utf8') > 72) return helpers.error('password.maxBytes');
  return value;
}).required();

export const registrationSchema = wrap(Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  email,
  password,
}).unknown(false));

export const loginSchema = wrap(Joi.object({
  email,
  password: loginPassword,
}).unknown(false));

export const membershipSchema = wrap(Joi.object({
  planId: Joi.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).required().messages({
    'string.pattern.base': 'Choose a valid plan.',
    'any.required': 'Choose a valid plan.',
  }),
}).unknown(false));

export const paginationSchema = wrap(Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(20),
}).unknown(false));
