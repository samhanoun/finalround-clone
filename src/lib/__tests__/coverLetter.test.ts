import { getToneGuidance } from '../coverLetter';

describe('coverLetter', () => {
  describe('getToneGuidance', () => {
    it('should return professional guidance for professional tone', () => {
      const guidance = getToneGuidance('professional');
      expect(guidance).toContain('polished');
      expect(guidance).toContain('business-appropriate');
    });

    it('should return friendly guidance for friendly tone', () => {
      const guidance = getToneGuidance('friendly');
      expect(guidance).toContain('warm');
      expect(guidance).toContain('approachable');
    });

    it('should return formal guidance for formal tone', () => {
      const guidance = getToneGuidance('formal');
      expect(guidance).toContain('professional');
      expect(guidance).toContain('traditional');
    });

    it('should return casual guidance for casual tone', () => {
      const guidance = getToneGuidance('casual');
      expect(guidance).toContain('relaxed');
      expect(guidance).toContain('conversational');
    });

    it('should return confident guidance for confident tone', () => {
      const guidance = getToneGuidance('confident');
      expect(guidance).toContain('strong');
      expect(guidance).toContain('assertive');
    });

    it('should default to professional for unknown tone', () => {
      // @ts-expect-error Testing invalid input
      const guidance = getToneGuidance('invalid');
      expect(guidance).toContain('polished');
    });
  });
});
