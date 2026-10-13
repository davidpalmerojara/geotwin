import { describe, expect, it } from 'vitest';
import { errorStatus, isIncompleteUpload } from '../src/app.js';
import { AppError } from '../src/modules/errors.js';

describe('Error status', () => {
  it('treats a client that stops sending mid-upload as a 400, not a server fault', () => {
    const cut = new Error('Part terminated early due to unexpected end of multipart data');
    const aborted = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    for (const error of [cut, new Error('Unexpected end of multipart data'), aborted]) {
      expect(isIncompleteUpload(error)).toBe(true);
      expect(errorStatus(error)).toBe(400);
    }
  });

  it('keeps real failures as 500 and app errors as they are', () => {
    // A storage or database connection reset is the server's problem.
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isIncompleteUpload(reset)).toBe(false);
    expect(errorStatus(reset)).toBe(500);
    expect(errorStatus(new Error('boom'))).toBe(500);
    expect(errorStatus(new AppError(409, 'DUPLICATE_LAYER', 'x'))).toBe(409);
    expect(errorStatus({ statusCode: 413 })).toBe(413);
  });
});
