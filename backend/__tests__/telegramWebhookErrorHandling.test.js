/**
 * Regression suite for T-032 (2026-08-18, PM continuous-improvement pass).
 *
 * Bug: telegramController.handleWebhook had no try/catch around anything
 * after the initial res.sendStatus(200). Express 4 doesn't await async
 * route handlers, so an unhandled rejection inside this one handler (e.g.
 * User.findOne/user.save() throwing) becomes a real process-level
 * 'unhandledRejection' event -- and server.js listens for exactly that
 * event and responds by calling server.close() then process.exit(1). A
 * single failed DB call inside one Telegram webhook could have taken down
 * the entire backend server (every API route, every WebSocket connection,
 * every cron job) for every user, not just failed this one interaction.
 * This suite proves handleWebhook now swallows the error instead of
 * leaving it to escape as an unhandled rejection.
 */
const User = require('../src/models/User');
const { handleWebhook } = require('../src/controllers/telegramController');

function fakeRes() {
  return { sendStatus: jest.fn() };
}

describe('telegramController.handleWebhook — error containment (T-032)', () => {
  test('a User.findOne failure during /start does not throw / reject uncaught', async () => {
    User.findOne = async () => { throw new Error('DB blip'); };

    const req = {
      body: {
        message: {
          chat: { id: 12345 },
          text: '/start sometoken',
        },
      },
    };

    // If handleWebhook lets the error escape as an unhandled promise
    // rejection rather than awaiting/catching it internally, this
    // expectation is what proves it: the returned promise itself must
    // resolve cleanly, not reject.
    await expect(handleWebhook(req, fakeRes())).resolves.not.toThrow();
  });

  test('a user.save() failure during /stop does not throw / reject uncaught', async () => {
    User.findOne = async () => ({
      preferences: {},
      save: async () => { throw new Error('validation blip'); },
    });

    const req = {
      body: {
        message: {
          chat: { id: 12345 },
          text: '/stop',
        },
      },
    };

    await expect(handleWebhook(req, fakeRes())).resolves.not.toThrow();
  });

  test('still acknowledges Telegram immediately with 200, before any awaits', async () => {
    User.findOne = async () => { throw new Error('DB blip'); };
    const res = fakeRes();

    const req = { body: { message: { chat: { id: 1 }, text: '/start x' } } };
    await handleWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a malformed update body (no message) is a safe no-op', async () => {
    const req = { body: {} };
    await expect(handleWebhook(req, fakeRes())).resolves.not.toThrow();
  });
});
