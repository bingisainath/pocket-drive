import { Router } from 'express';
import { HttpError } from '../http-error.js';

const PLATFORMS = new Set(['android', 'ios']);

/** Register/unregister this device's push token for the signed-in user. Mounted behind requireAuth. */
export function deviceRoutes(ctx) {
  const { devices } = ctx;
  const router = Router();

  router.post('/devices', (req, res) => {
    const { token, platform } = req.body ?? {};
    if (typeof token !== 'string' || token.length < 1 || token.length > 4096) throw new HttpError(400, 'Missing device token');
    if (!PLATFORMS.has(platform)) throw new HttpError(400, 'Unknown platform');
    devices.register(req.user.id, token, platform);
    res.status(204).end();
  });

  // The token may come in the body or as ?token= (some HTTP stacks drop DELETE bodies). Scoped to the user.
  router.delete('/devices', (req, res) => {
    const token = req.body?.token ?? req.query.token;
    if (typeof token !== 'string' || !token) throw new HttpError(400, 'Missing device token');
    devices.unregister(req.user.id, token);
    res.status(204).end();
  });

  return router;
}
