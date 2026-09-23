import { mentionIdOf, mentionLink } from './mentions';

describe('mention links', () => {
  it('carry the person’s id and read back', () => {
    const link = mentionLink('Bob [admin]', '@bob:example.org');
    expect(link).toBe('[Bob \\[admin\\]](mention:%40bob%3Aexample.org)');
    expect(mentionIdOf('mention:%40bob%3Aexample.org')).toBe('@bob:example.org');
  });

  it('ignore every other link', () => {
    expect(mentionIdOf('https://example.org')).toBeNull();
    expect(mentionIdOf('mention:%E0%A4%A')).toBeNull();
  });
});
