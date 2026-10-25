import { SCREEN_FRAME_MAX_WIDTH, fitWithin, grabScreenFrame } from '@/lib/copilot/screenFrame';

describe('fitWithin', () => {
  it('scales wide frames down to the max width, keeping the aspect ratio', () => {
    expect(fitWithin(3840, 2160, SCREEN_FRAME_MAX_WIDTH)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(2560, 1600, 1600)).toEqual({ width: 1600, height: 1000 });
  });

  it('never scales up', () => {
    expect(fitWithin(1280, 720, SCREEN_FRAME_MAX_WIDTH)).toEqual({ width: 1280, height: 720 });
  });
});

describe('grabScreenFrame', () => {
  it('refuses a track that has stopped', async () => {
    const ended = { readyState: 'ended' } as MediaStreamTrack;
    await expect(grabScreenFrame(ended)).rejects.toThrow('Screen sharing has stopped.');
  });
});
