import { assessNodeRuntime, judgeNodeRuntime, nodeMajor, SUPPORTED_NODE_MAJORS } from './node-support';

describe('node runtime support', () => {
  it('reads the major from a version string', () => {
    expect(nodeMajor('v22.12.0')).toBe(22);
    expect(nodeMajor('24.1.0')).toBe(24);
    expect(nodeMajor('not-a-version')).toBeNull();
  });

  it('calls Node 20 supported before, and end of life on and after, its published date', () => {
    expect(assessNodeRuntime('v20.20.1', '2026-04-29').status).toBe('untested');
    expect(assessNodeRuntime('v20.20.1', '2026-04-30')).toEqual({ version: 'v20.20.1', major: 20, status: 'endOfLife', endOfLife: '2026-04-30' });
    expect(assessNodeRuntime('v20.20.1', '2026-11-13').status).toBe('endOfLife');
  });

  it('supports exactly the CI-verified majors that are still receiving fixes', () => {
    for (const major of SUPPORTED_NODE_MAJORS) expect(assessNodeRuntime(`v${major}.0.0`, '2026-11-13').status).toBe('supported');
    expect(SUPPORTED_NODE_MAJORS).toEqual([22, 24]);
  });

  it('never calls a major newer than the table unsupported, and treats one older than the table as end of life', () => {
    expect(assessNodeRuntime('v40.0.0', '2026-11-13')).toEqual({ version: 'v40.0.0', major: 40, status: 'untested', endOfLife: null });
    expect(assessNodeRuntime('v14.21.3', '2026-11-13').status).toBe('endOfLife');
  });

  it('an unreadable version has no verdict', () => {
    expect(assessNodeRuntime('weird', '2026-11-13').status).toBe('unknown');
  });

  it('warns about an end-of-life runtime but only refuses to start when ENFORCE_SUPPORTED_NODE is on', () => {
    const warn = judgeNodeRuntime('v20.20.1', '2026-11-13', {});
    expect(warn.refuse).toBe(false);
    expect(warn.message).toContain('past its end of life');
    expect(warn.message).toContain('ENFORCE_SUPPORTED_NODE=true');

    const refuse = judgeNodeRuntime('v20.20.1', '2026-11-13', { ENFORCE_SUPPORTED_NODE: 'true' });
    expect(refuse.refuse).toBe(true);
    expect(refuse.message).toContain('refusing to start');
  });

  it('says nothing about a supported runtime, and only notes an untested one', () => {
    expect(judgeNodeRuntime('v22.23.5', '2026-11-13', {})).toMatchObject({ refuse: false, message: null });
    const untested = judgeNodeRuntime('v26.13.1', '2026-11-13', { ENFORCE_SUPPORTED_NODE: 'true' });
    expect(untested.refuse).toBe(false);
    expect(untested.message).toContain('not one of the versions CCB is tested on');
  });
});
