import {
  getConsentStatus,
  checkIngestConsent,
  grantConsentMetadata,
  revokeConsentMetadata,
  isConsentValidAt,
  ConsentStatus,
} from '@/lib/copilotConsent';

describe('copilotConsent', () => {
  const now = '2026-02-18T12:00:00Z';

  describe('getConsentStatus', () => {
    it('returns granted when consent_status is granted', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'granted' },
      };
      expect(getConsentStatus(session)).toBe('granted');
    });

    it('returns revoked when consent_status is revoked', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'revoked' },
      };
      expect(getConsentStatus(session)).toBe('revoked');
    });

    it('returns pending when consent_status is missing', () => {
      const session = {
        status: 'active',
        metadata: {},
      };
      expect(getConsentStatus(session)).toBe('pending');
    });

    it('returns pending when metadata is null', () => {
      const session = {
        status: 'active',
        metadata: null,
      };
      expect(getConsentStatus(session)).toBe('pending');
    });

    it('returns pending when metadata is undefined', () => {
      const session = {
        status: 'active',
      };
      expect(getConsentStatus(session)).toBe('pending');
    });

    it('returns pending for invalid consent_status', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'invalid' },
      };
      expect(getConsentStatus(session)).toBe('pending');
    });

    it('returns expired when consent_status is expired', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'expired' },
      };
      expect(getConsentStatus(session)).toBe('expired');
    });
  });

  describe('checkIngestConsent', () => {
    it('allows ingest when session is active and consent granted', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'granted' },
      };
      expect(checkIngestConsent(session)).toEqual({ allowed: true });
    });

    it('rejects when session is not active', () => {
      const session = {
        status: 'stopped',
        metadata: { consent_status: 'granted' },
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'session_not_active',
      });
    });

    it('rejects when session is expired', () => {
      const session = {
        status: 'expired',
        metadata: { consent_status: 'granted' },
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'session_not_active',
      });
    });

    it('rejects with consent_pending when consent is pending', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'pending' },
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'consent_pending',
      });
    });

    it('rejects with consent_revoked when consent was revoked', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'revoked' },
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'consent_revoked',
      });
    });

    it('rejects with consent_expired when consent expired', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'expired' },
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'consent_expired',
      });
    });

    it('rejects with consent_pending when no consent metadata exists', () => {
      const session = {
        status: 'active',
        metadata: {},
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'consent_pending',
      });
    });

    it('rejects with consent_pending when metadata is null', () => {
      const session = {
        status: 'active',
        metadata: null,
      };
      expect(checkIngestConsent(session)).toEqual({
        allowed: false,
        reason: 'consent_pending',
      });
    });
  });

  describe('grantConsentMetadata', () => {
    it('adds consent_status and consent_granted_at to metadata', () => {
      const existing = { foo: 'bar' };
      const result = grantConsentMetadata(existing, now);

      expect(result).toHaveProperty('consent_status', 'granted');
      expect(result).toHaveProperty('consent_granted_at', now);
      expect(result).toHaveProperty('foo', 'bar');
    });

    it('handles null metadata', () => {
      const result = grantConsentMetadata(null, now);

      expect(result).toHaveProperty('consent_status', 'granted');
      expect(result).toHaveProperty('consent_granted_at', now);
    });

    it('handles undefined metadata', () => {
      const result = grantConsentMetadata(undefined, now);

      expect(result).toHaveProperty('consent_status', 'granted');
      expect(result).toHaveProperty('consent_granted_at', now);
    });
  });

  describe('revokeConsentMetadata', () => {
    it('adds consent_status and consent_revoked_at to metadata', () => {
      const existing = { foo: 'bar', consent_status: 'granted' as ConsentStatus };
      const result = revokeConsentMetadata(existing, now);

      expect(result).toHaveProperty('consent_status', 'revoked');
      expect(result).toHaveProperty('consent_revoked_at', now);
      expect(result).toHaveProperty('foo', 'bar');
    });

    it('handles null metadata', () => {
      const result = revokeConsentMetadata(null, now);

      expect(result).toHaveProperty('consent_status', 'revoked');
      expect(result).toHaveProperty('consent_revoked_at', now);
    });
  });

  describe('isConsentValidAt', () => {
    it('returns true when consent granted and never revoked', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'granted' },
      };
      expect(isConsentValidAt(session, now)).toBe(true);
    });

    it('returns false when consent is revoked', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'revoked' },
      };
      expect(isConsentValidAt(session, now)).toBe(false);
    });

    it('returns false when consent is pending', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'pending' },
      };
      expect(isConsentValidAt(session, now)).toBe(false);
    });

    it('returns false when action is after revocation', () => {
      const session = {
        status: 'active',
        metadata: {
          consent_status: 'granted',
          consent_revoked_at: '2026-02-18T11:00:00Z',
        },
      };
      // Action at 12:00, revoked at 11:00 - should be INVALID (action after revoke)
      expect(isConsentValidAt(session, '2026-02-18T12:00:00Z')).toBe(false);
    });

    it('returns true when action is before revocation', () => {
      const session = {
        status: 'active',
        metadata: {
          consent_status: 'granted',
          consent_revoked_at: '2026-02-18T12:00:00Z',
        },
      };
      // Action at 11:00, revoked at 12:00 - should be valid
      expect(isConsentValidAt(session, '2026-02-18T11:00:00Z')).toBe(true);
    });

    it('returns false when action is after revocation', () => {
      const session = {
        status: 'active',
        metadata: {
          consent_status: 'granted',
          consent_revoked_at: '2026-02-18T11:00:00Z',
        },
      };
      // Action at 12:00, revoked at 11:00 - should be invalid (action after revoke)
      expect(isConsentValidAt(session, '2026-02-18T12:00:00Z')).toBe(false);
    });

    it('returns false when consent is not granted', () => {
      const session = {
        status: 'active',
        metadata: { consent_status: 'pending' },
      };
      expect(isConsentValidAt(session, now)).toBe(false);
    });
  });
});
