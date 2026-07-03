async function main() {
  var sess = await nomad.session.get();
  console.log(sess);

  var btn = document.createElement('button');
  if (sess) {
    btn.textContent = 'Log out';
    btn.onclick = async () => console.log(await nomad.session.destroy());
  } else {
    btn.textContent = 'Log in';
    btn.onclick = async () => {
      await doLog(
        false,
        'bad session request',
        nomad.session.request({
          permissions: {
            publicFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/comments/*.md', access: 'read' },
              { path: '/*.txt', access: 'write' },
            ],
            privateFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/test/*.txt', access: 'write' },
            ],
          },
        })
      );
      await doLog(
        false,
        'bad session request',
        nomad.session.request({
          permissions: {
            publicFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/comments/*.md', access: 'read' },
              { path: '/test/*', access: 'write' },
            ],
            privateFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/test/test/*.txt', access: 'write' },
            ],
          },
        })
      );
      await doLog(
        true,
        'good session request',
        nomad.session.request({
          permissions: {
            publicFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/comments/*.md', access: 'read' },
              { path: '/nomad-tests/test/*.txt', access: 'write' },
            ],
            privateFiles: [
              { path: '/pages/*.md', access: 'read' },
              { path: '/nomad-tests/test/*.txt', access: 'write' },
            ],
          },
        })
      );
    };
  }
  document.body.append(btn);

  doLog(
    true,
    'query /pages .md',
    nomad.index.gql(`query { records (paths: ["/pages/*.md"]) { url } }`)
  );
  doLog(
    true,
    'query /microblog .md',
    nomad.index.gql(`query { records (paths: ["/microblog/*.md"]) { url } }`)
  );
  doLog(
    true,
    'query private /pages .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://private"], paths: ["/pages/*.md"]) { url } }`
    )
  );
  doLog(
    false,
    'query private /microblog .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://private"], paths: ["/microblog/*.md"]) { url } }`
    )
  );
  doLog(
    true,
    'query private,public /pages .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md"]) { url } }`
    )
  );
  doLog(
    false,
    'query private,public /microblog .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/microblog/*.md"]) { url } }`
    )
  );
  doLog(
    true,
    'query public /pages .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md"]) { url } }`
    )
  );
  doLog(
    true,
    'query public /microblog .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/microblog/*.md"]) { url } }`
    )
  );
  doLog(
    true,
    'query /pages,/microblog .md',
    nomad.index.gql(
      `query { records (paths: ["/pages/*.md", "/microblog/*.md"]) { url } }`
    )
  );
  doLog(
    false,
    'query public,private /pages,/microblog .md',
    nomad.index.gql(
      `query { records (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md", "/microblog/*.md"]) { url } }`
    )
  );

  doLog(
    true,
    'count /pages .md',
    nomad.index.gql(`query { recordCount (paths: ["/pages/*.md"]) }`)
  );
  doLog(
    true,
    'count /microblog .md',
    nomad.index.gql(`query { recordCount (paths: ["/microblog/*.md"]) }`)
  );
  doLog(
    true,
    'count private /pages .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://private"], paths: ["/pages/*.md"]) }`
    )
  );
  doLog(
    false,
    'count private /microblog .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://private"], paths: ["/microblog/*.md"]) }`
    )
  );
  doLog(
    true,
    'count private,public /pages .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md"]) }`
    )
  );
  doLog(
    false,
    'count private,public /microblog .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/microblog/*.md"]) }`
    )
  );
  doLog(
    true,
    'count public /pages .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md"]) }`
    )
  );
  doLog(
    true,
    'count public /microblog .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/microblog/*.md"]) }`
    )
  );
  doLog(
    true,
    'count /pages,/microblog .md',
    nomad.index.gql(
      `query { recordCount (paths: ["/pages/*.md", "/microblog/*.md"]) }`
    )
  );
  doLog(
    false,
    'count public,private /pages,/microblog .md',
    nomad.index.gql(
      `query { recordCount (origins: ["hyper://private", "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39"], paths: ["/pages/*.md", "/microblog/*.md"]) }`
    )
  );

  doLog(
    true,
    'get public /pages/test-page.md',
    nomad.index.gql(
      `query { record (url: "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39/pages/test-page.md") { url } }`
    )
  );
  doLog(
    true,
    'get private /pages/sessions-api.md',
    nomad.index.gql(
      `query { record (url: "hyper://private/pages/sessions-api.md") { url } }`
    )
  );
  doLog(
    true,
    'get public /microblog/*.md',
    nomad.index.gql(
      `query { record (url: "hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39/microblog/1599085611199.md") { url } }`
    )
  );
  doLog(
    false,
    'get private /comments/*.md',
    nomad.index.gql(
      `query { record (url: "hyper://private/comments/1599076506408.md") { url } }`
    )
  );
  doLog(
    false,
    'get private /index.json',
    nomad.index.gql(
      `query { record (url: "hyper://private/index.json") { url } }`
    )
  );
  doLog(
    false,
    'get private /pages/foo.json',
    nomad.index.gql(
      `query { record (url: "hyper://private/pages/foo.json") { url } }`
    )
  );

  var priv = nomad.hyperdrive.drive('hyper://private');
  var pub = nomad.hyperdrive.drive(
    'hyper://6900790c2dba488ca132a0ca6d7259180e993b285ede6b29b464b62453cd5c39/'
  );
  doLog(false, 'readdir(/) private', priv.readdir('/'));
  doLog(true, 'readdir(/) public', pub.readdir('/'));
  doLog(false, 'readdir(/blog) private', priv.readdir('/blog'));
  doLog(true, 'readdir(/blog) public', pub.readdir('/blog'));
  doLog(true, 'readdir(/pages) private', priv.readdir('/pages'));
  doLog(true, 'readdir(/pages) public', pub.readdir('/pages'));
  doLog(false, 'stat(/index.json) private', priv.stat('/index.json'));
  doLog(true, 'stat(/index.json) public', pub.stat('/index.json'));
  doLog(
    true,
    'stat(/pages/decribing-nomad.md) private',
    priv.stat('/pages/decribing-nomad.md')
  );
  doLog(false, 'stat(/pages/foo.json) private', priv.stat('/pages/foo.json'));
  doLog(
    true,
    'stat(/pages/test-page.md) public',
    pub.stat('/pages/test-page.md')
  );
  doLog(false, 'readFile(/index.json) private', priv.readFile('/index.json'));
  doLog(true, 'readFile(/index.json) public', pub.readFile('/index.json'));
  doLog(
    true,
    'readFile(/pages/decribing-nomad.md) private',
    priv.readFile('/pages/decribing-nomad.md')
  );
  doLog(
    false,
    'readFile(/pages/foo.json) private',
    priv.readFile('/pages/foo.json')
  );
  doLog(
    true,
    'readFile(/pages/test-page.md) public',
    pub.readFile('/pages/test-page.md')
  );
  doLog(false, 'query(/pages) private', priv.query({ path: '/pages/*' }));

  await doLog(
    true,
    'writeFile(/nomad-tests/test/hello.txt) private',
    priv.writeFile('/nomad-tests/test/hello.txt', 'world')
  );
  await doLog(
    true,
    'writeFile(/nomad-tests/test/hello.txt) public',
    pub.writeFile('/nomad-tests/test/hello.txt', 'world')
  );
  await doLog(
    false,
    'writeFile(/nomad-tests/test/hello.json) private',
    priv.writeFile('/nomad-tests/test/hello.json', 'world')
  );
  await doLog(
    false,
    'writeFile(/nomad-tests/test/hello.json) public',
    pub.writeFile('/nomad-tests/test/hello.json', 'world')
  );
  await doLog(
    false,
    'writeFile(/pages/hello.md) private',
    priv.writeFile('/pages/hello.md', 'world')
  );
  await doLog(
    false,
    'writeFile(/pages/hello.md) public',
    pub.writeFile('/pages/hello.md', 'world')
  );

  await doLog(
    true,
    'copy(/nomad-tests/test/hello.txt, /nomad-tests/test/hello2.txt) private',
    priv.copy('/nomad-tests/test/hello.txt', '/nomad-tests/test/hello2.txt')
  );
  await doLog(
    true,
    'copy(/nomad-tests/test/hello.txt, /nomad-tests/test/hello2.txt) public',
    pub.copy('/nomad-tests/test/hello.txt', '/nomad-tests/test/hello2.txt')
  );
  await doLog(
    true,
    'rename(/nomad-tests/test/hello2.txt, /nomad-tests/test/hello3.txt) private',
    priv.rename(
      '/nomad-tests/test/hello2.txt',
      '/nomad-tests/test/hello3.txt'
    )
  );
  await doLog(
    true,
    'rename(/nomad-tests/test/hello2.txt, /nomad-tests/test/hello3.txt) public',
    pub.rename('/nomad-tests/test/hello2.txt', '/nomad-tests/test/hello3.txt')
  );
  await doLog(
    true,
    'unlink(/nomad-tests/test/hello3.txt) private',
    priv.unlink('/nomad-tests/test/hello3.txt')
  );
  await doLog(
    true,
    'unlink(/nomad-tests/test/hello3.txt) public',
    pub.unlink('/nomad-tests/test/hello3.txt')
  );

  await doLog(
    false,
    'copy(/nomad-tests/test/hello.txt, /pages/hello.md) private',
    priv.copy('/nomad-tests/test/hello.txt', '/pages/hello.md')
  );
  await doLog(
    false,
    'copy(/nomad-tests/test/hello.txt, /pages/hello.md) public',
    pub.copy('/nomad-tests/test/hello.txt', '/pages/hello.md')
  );

  await doLog(
    false,
    'symlink(/index.json, /nomad-tests/test/index.txt) private',
    priv.symlink('/index.json', '/nomad-tests/test/index.txt')
  );
  await doLog(
    true,
    'symlink(/index.json, /nomad-tests/test/index.txt) public',
    pub.symlink('/index.json', '/nomad-tests/test/index.txt')
  );
  await doLog(
    true,
    'unlink(/nomad-tests/test/index.txt) public',
    pub.unlink('/nomad-tests/test/index.txt')
  );

  await doLog(
    false,
    'symlink(/nomad-tests/test/hello.txt, /pages/hello.md) private',
    priv.symlink('/nomad-tests/test/hello.txt', '/pages/hello.md')
  );
  await doLog(
    false,
    'symlink(/nomad-tests/test/hello.txt, /pages/hello.md) public',
    pub.symlink('/nomad-tests/test/hello.txt', '/pages/hello.md')
  );

  await doLog(
    true,
    'copy(/pages/decribing-nomad.md, /nomad-tests/test/describing-nomad.txt) private',
    priv.copy(
      '/pages/decribing-nomad.md',
      '/nomad-tests/test/describing-nomad.txt'
    )
  );
  await doLog(
    true,
    'copy(/pages/test-page.md, /nomad-tests/test/test-page.txt) public',
    pub.copy('/pages/test-page.md', '/nomad-tests/test/test-page.txt')
  );

  await doLog(
    true,
    'unlink(/nomad-tests/test/hello.txt) private',
    priv.unlink('/nomad-tests/test/hello.txt')
  );
  await doLog(
    true,
    'unlink(/nomad-tests/test/hello.txt) public',
    pub.unlink('/nomad-tests/test/hello.txt')
  );
  await doLog(
    false,
    'unlink(/nomad-tests/test/hello.json) private',
    priv.unlink('/nomad-tests/test/hello.json')
  );
  await doLog(
    false,
    'unlink(/nomad-tests/test/hello.json) public',
    pub.unlink('/nomad-tests/test/hello.json')
  );
  await doLog(
    false,
    'unlink(/pages/hello.md) private',
    priv.unlink('/pages/hello.md')
  );
  await doLog(
    false,
    'unlink(/pages/hello.md) public',
    pub.unlink('/pages/hello.md')
  );

  await doLog(
    false,
    'mkdir(/nomad-tests/test/sub)',
    priv.mkdir('/nomad-tests/test/sub')
  );
  await doLog(
    false,
    'mkdir(/nomad-tests/test/sub)',
    pub.mkdir('/nomad-tests/test/sub')
  );
  await doLog(false, 'rmdir(/test)', priv.rmdir('/test'));
  await doLog(false, 'rmdir(/test)', pub.rmdir('/test'));
}

async function doLog(shouldSucceed, text, promise) {
  try {
    var res = await promise;
    if (!shouldSucceed) {
      console.error('❌', text, res);
    } else {
      console.log('✅', text);
    }
  } catch (e) {
    if (shouldSucceed) {
      console.error('❌', text, e);
    } else {
      console.log('✅', text, e);
    }
  }
}

main();
