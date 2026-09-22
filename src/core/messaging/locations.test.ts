import { coordinatesLabel, mapsLinks, parseLocation } from './locations';

describe('parseLocation', () => {
  it('ignores ordinary links', () => {
    expect(parseLocation('https://github.com/tauri-apps/tauri')).toBeNull();
    expect(parseLocation('https://example.com/maps')).toBeNull();
  });

  it('reads geo URIs with and without a label', () => {
    expect(parseLocation('geo:48.8584,2.2945')).toMatchObject({ lat: 48.8584, lng: 2.2945 });
    expect(parseLocation('geo:0,0?q=48.8584,2.2945(Eiffel%20Tower)')).toMatchObject({
      lat: 48.8584,
      lng: 2.2945,
      label: 'Eiffel Tower',
    });
    expect(parseLocation('geo:0,0?q=Eiffel+Tower')).toMatchObject({ label: 'Eiffel Tower' });
    expect(parseLocation('geo:0,0')).toBeNull();
  });

  it('reads Apple Maps links', () => {
    expect(
      parseLocation('https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffel%20Tower')
    ).toMatchObject({
      lat: 48.8584,
      lng: 2.2945,
      label: 'Eiffel Tower',
    });
    expect(parseLocation('https://maps.apple.com/?q=48.8584,2.2945')).toMatchObject({
      lat: 48.8584,
      lng: 2.2945,
    });
    expect(parseLocation('https://maps.apple.com/?address=1+Infinite+Loop')?.label).toBe(
      '1 Infinite Loop'
    );
  });

  it('reads Google Maps links, including short ones without coordinates', () => {
    expect(
      parseLocation('https://www.google.com/maps/place/Tour+Eiffel/@48.8584,2.2945,17z/data=!3m1')
    ).toMatchObject({ lat: 48.8584, lng: 2.2945, label: 'Tour Eiffel' });
    expect(parseLocation('https://maps.google.com/?q=48.8584,2.2945')).toMatchObject({
      lat: 48.8584,
      lng: 2.2945,
    });
    expect(
      parseLocation('https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945')
    ).toMatchObject({ lat: 48.8584, lng: 2.2945 });
    expect(parseLocation('https://maps.app.goo.gl/AbCdEf')).toEqual({
      url: 'https://maps.app.goo.gl/AbCdEf',
    });
  });

  it('reads OpenStreetMap links', () => {
    expect(
      parseLocation('https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945#map=17/48.8584/2.2945')
    ).toMatchObject({ lat: 48.8584, lng: 2.2945 });
    expect(parseLocation('https://www.openstreetmap.org/#map=17/48.8584/2.2945')).toMatchObject({
      lat: 48.8584,
      lng: 2.2945,
    });
  });

  it('rejects impossible coordinates', () => {
    expect(parseLocation('geo:123.4,5.6')).toBeNull();
  });
});

describe('mapsLinks', () => {
  it('builds Apple and geo links from coordinates and a label', () => {
    expect(mapsLinks({ url: 'x', lat: 48.8584, lng: 2.2945, label: 'Eiffel Tower' })).toEqual({
      apple: 'https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffel%20Tower',
      geo: 'geo:48.8584,2.2945?q=48.8584,2.2945(Eiffel%20Tower)',
    });
  });

  it('falls back to the original link when there are no coordinates', () => {
    const url = 'https://maps.app.goo.gl/AbCdEf';
    expect(mapsLinks({ url })).toEqual({ apple: url, geo: 'geo:0,0?q=' });
  });
});

describe('coordinatesLabel', () => {
  it('formats to five decimals', () => {
    expect(coordinatesLabel({ url: 'x', lat: 48.8584, lng: 2.2945 })).toBe('48.85840, 2.29450');
    expect(coordinatesLabel({ url: 'x' })).toBeNull();
  });
});
