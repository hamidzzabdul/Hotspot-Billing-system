import { decrypt, HttpError } from './utils.js';
export function routerClient(config) {
  async function request(router, path, method = 'GET', data) {
    if (!router.enabled) throw new HttpError(503, 'This router is disabled');
    const res = await fetch(`${router.baseUrl.replace(/\/$/, '')}/rest/${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${router.username}:${decrypt(router.password, config)}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    if (!res.ok) throw new HttpError(502, `Router request failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }
  return {
    async inspect(router) {
      const [resources, active] = await Promise.all([
        request(router, 'system/resource'),
        request(router, 'ip/hotspot/active'),
      ]);
      return {
        connected: active.length,
        uptime: (Array.isArray(resources) ? resources[0] : resources)?.uptime || '',
        active,
      };
    },
    async validateDevice(router, mac) {
      const hosts = await request(router, 'ip/hotspot/host');
      if (!hosts.some((host) => host['mac-address']?.toUpperCase() === mac))
        throw new HttpError(400, 'This device is not connected to the selected hotspot');
    },
    async provision(router, access) {
      const profileName = `wifex-${access.speedMbps}M`;
      const profiles = await request(router, 'ip/hotspot/user/profile');
      if (!profiles.some((p) => p.name === profileName))
        await request(router, 'ip/hotspot/user/profile', 'PUT', {
          name: profileName,
          'rate-limit': `${access.speedMbps}M/${access.speedMbps}M`,
          'shared-users': '1',
          'add-mac-cookie': 'no',
        });
      const users = await request(router, 'ip/hotspot/user');
      const existing = users.find((u) => u.name === access.username);
      // Wall-clock limit is also enforced by the server expiry worker.
      const seconds = Math.max(1, Math.floor((access.expiresAt.getTime() - Date.now()) / 1000));
      if (!existing)
        await request(router, 'ip/hotspot/user', 'PUT', {
          name: access.username,
          password: decrypt(access.password, config),
          'mac-address': access.macAddress,
          profile: profileName,
          'limit-uptime': `${seconds}s`,
          disabled: 'true',
          comment: `wifex:${access._id}`,
        });
      // A router-local repeating guard also enforces expiry while the VPS is unavailable
      // and after router reboot. Requires RouterOS >= 7.10 (:timestamp and :tonsec).
      const schedulerName = `wf-exp-${access._id}`;
      const schedulers = await request(router, 'system/scheduler');
      if (!schedulers.some((item) => item.name === schedulerName)) {
        const epoch = Math.floor(access.expiresAt.getTime() / 1000);
        const username = access.username; // generated internally from hex, never user-supplied script text
        await request(router, 'system/scheduler', 'PUT', {
          name: schedulerName,
          interval: '30s',
          'start-time': 'startup',
          policy: 'read,write,test',
          'on-event': `:if (([:tonsec [:timestamp]] / 1000000000) >= ${epoch}) do={ /ip hotspot user disable [find where name="${username}"]; /ip hotspot active remove [find where user="${username}"]; /ip hotspot cookie remove [find where user="${username}"]; /system scheduler remove [find where name="${schedulerName}"]; }`,
        });
      }
      const updatedUsers = await request(router, 'ip/hotspot/user');
      const target = updatedUsers.find((item) => item.name === access.username);
      if (!target) throw new HttpError(502, 'Router user was not created');
      await request(router, `ip/hotspot/user/${encodeURIComponent(target['.id'])}`, 'PATCH', {
        disabled: 'false',
      });
    },
    async revoke(router, access) {
      // Disable credentials first; then disconnect and remove persistent cookies.
      const users = await request(router, 'ip/hotspot/user');
      for (const user of users.filter((u) => u.name === access.username))
        await request(router, `ip/hotspot/user/${encodeURIComponent(user['.id'])}`, 'PATCH', {
          disabled: 'true',
        });
      for (const menu of ['active', 'cookie']) {
        const records = await request(router, `ip/hotspot/${menu}`);
        for (const item of records.filter((u) => u.user === access.username))
          await request(router, `ip/hotspot/${menu}/${encodeURIComponent(item['.id'])}`, 'DELETE');
      }
      const schedulers = await request(router, 'system/scheduler');
      for (const item of schedulers.filter((s) => s.name === `wf-exp-${access._id}`))
        await request(router, `system/scheduler/${encodeURIComponent(item['.id'])}`, 'DELETE');
    },
  };
}
