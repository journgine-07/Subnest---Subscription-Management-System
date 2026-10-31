// More than 8 characters, with an uppercase letter, a lowercase letter and a special character.
export const passwordOK = p => typeof p === 'string' && p.length > 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[^A-Za-z0-9]/.test(p);
export const PASSWORD_MESSAGE = 'Password must be more than 8 characters and include an uppercase letter, a lowercase letter and a special character.';
export const emailOK = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
export const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]]));
