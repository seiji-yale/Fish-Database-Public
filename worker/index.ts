import { Hono } from 'hono';
import pkg from '../package.json';
import { handleError } from './lib/errors';
import { sessionGate, type Bindings } from './middleware/session';
import { attachmentRoutes } from './routes/attachments';
import { attributionRoutes } from './routes/attribution';
import { enumerationRoutes } from './routes/enumerations';
import { lineActivityRoutes } from './routes/lineActivity';
import { lineProtocolRoutes } from './routes/lineProtocols';
import { lineCryoRoutes } from './routes/lineCryo';
import { lineAttachmentRoutes } from './routes/lineAttachments';
import { adminRoutes } from './routes/admin';
import { lineEditRoutes } from './routes/lineEdit';
import { lineDetailRoutes } from './routes/lineDetail';
import { linesRoutes } from './routes/lines';
import { dashboardRoutes } from './routes/dashboard';
import { sessionRoutes } from './routes/session';
import { chatRoutes } from './routes/chat';
import { mirrorDirtyMarker } from './mirror/dirty';
import { readOnlyGuard } from './lib/readOnly';
import { scheduledMirror } from './mirror/run';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', sessionGate());
app.use('/api/*', readOnlyGuard());
app.use('/api/*', mirrorDirtyMarker());

app.get('/api/health', (c) => c.json({ ok: true, version: pkg.version }));
app.route('/api', sessionRoutes);
app.route('/api', attributionRoutes);
app.route('/api', linesRoutes);
app.route('/api', enumerationRoutes);
app.route('/api', dashboardRoutes);
app.route('/api', lineDetailRoutes);
app.route('/api', lineEditRoutes);
app.route('/api', lineActivityRoutes);
app.route('/api', lineProtocolRoutes);
app.route('/api', lineCryoRoutes);
app.route('/api', lineAttachmentRoutes);
app.route('/api', adminRoutes);
app.route('/api', attachmentRoutes);
app.route('/api', chatRoutes);
app.onError(handleError);

/**
 * The Dropbox mirror's minute cron (T-020): exports when a change is old enough, or nightly. Without
 * Dropbox secrets it does nothing. `Object.assign` keeps `app.request` (tests) and adds `scheduled`.
 */
export default Object.assign(app, {
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): void {
    ctx.waitUntil(scheduledMirror(env, new Date()));
  },
});
