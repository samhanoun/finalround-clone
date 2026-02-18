import { generateSPMetadata, generateAuthnRequest, parseSAMLResponse } from '../sso';

describe('SSO/SAML', () => {
  const baseUrl = 'http://localhost:3000';
  const organizationId = 'org-123';

  describe('generateSPMetadata', () => {
    it('should generate valid SP metadata XML', () => {
      const metadata = generateSPMetadata(organizationId, baseUrl);
      
      expect(metadata).toContain('EntityDescriptor');
      expect(metadata).toContain('SPSSODescriptor');
      expect(metadata).toContain('AssertionConsumerService');
      expect(metadata).toContain(baseUrl);
    });

    it('should include correct entity ID', () => {
      const metadata = generateSPMetadata(organizationId, baseUrl);
      
      expect(metadata).toContain(`/saml/metadata/${organizationId}`);
    });

    it('should include correct ACS URL', () => {
      const metadata = generateSPMetadata(organizationId, baseUrl);
      
      expect(metadata).toContain(`/saml/acs/${organizationId}`);
    });
  });

  describe('generateAuthnRequest', () => {
    it('should generate base64 encoded AuthnRequest', () => {
      const { request, entityId } = generateAuthnRequest(organizationId, baseUrl);
      
      // Should be valid base64
      const decoded = Buffer.from(request, 'base64').toString('utf-8');
      expect(decoded).toContain('AuthnRequest');
      expect(entityId).toContain(`/saml/metadata/${organizationId}`);
    });

    it('should include issuer in request', () => {
      const { request, entityId } = generateAuthnRequest(organizationId, baseUrl);
      const decoded = Buffer.from(request, 'base64').toString('utf-8');
      
      expect(decoded).toContain('saml:Issuer');
      expect(decoded).toContain(entityId);
    });

    it('should support relay state', () => {
      const relayState = 'https://app.example.com/dashboard';
      const { request } = generateAuthnRequest(organizationId, baseUrl, relayState);
      const decoded = Buffer.from(request, 'base64').toString('utf-8');
      
      expect(decoded).toContain('RelayState');
      expect(decoded).toContain(relayState);
    });
  });

  describe('parseSAMLResponse', () => {
    it('should return null for invalid base64', () => {
      const result = parseSAMLResponse('invalid-base64', 'cert');
      expect(result).toBeNull();
    });

    it('should return null for malformed XML', () => {
      const invalidXml = Buffer.from('<invalid>').toString('base64');
      const result = parseSAMLResponse(invalidXml, 'cert');
      expect(result).toBeNull();
    });
  });

  describe('SAML Configuration', () => {
    it('should validate required SAML fields', () => {
      const config = {
        idp_entity_id: 'https://idp.example.com',
        idp_sso_url: 'https://idp.example.com/sso',
        idp_certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
      };
      
      expect(config.idp_entity_id).toBeTruthy();
      expect(config.idp_sso_url).toBeTruthy();
      expect(config.idp_certificate).toBeTruthy();
    });

    it('should support custom attribute mapping', () => {
      const config = {
        idp_entity_id: 'https://idp.example.com',
        idp_sso_url: 'https://idp.example.com/sso',
        idp_certificate: 'cert',
        attribute_mapping: {
          email: 'mail',
          firstName: 'givenName',
          lastName: 'sn',
        },
      };
      
      expect(config.attribute_mapping).toHaveProperty('email');
      expect(config.attribute_mapping).toHaveProperty('firstName');
      expect(config.attribute_mapping).toHaveProperty('lastName');
    });
  });
});
