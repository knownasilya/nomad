// exported
// =

export async function loadProfile() {
  try {
    var addressBook = await beaker.hyperdrive
      .readFile('hyper://private/address-book.json')
      .then(JSON.parse);
    if (!addressBook?.profiles?.[0]?.key) return undefined;
    return beaker.hyperdrive.drive(addressBook.profiles[0].key).getInfo();
  } catch (e) {
    console.log('Failed to load profile', e);
  }
  return undefined;
}
