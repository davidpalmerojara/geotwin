export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function notFound(entity: string, gender: 'm' | 'f' = 'm'): never {
  throw new AppError(404, 'NOT_FOUND', `${entity} no encontrad${gender === 'f' ? 'a' : 'o'}`);
}
