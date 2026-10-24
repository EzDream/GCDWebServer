/* Download files and folder archives with progress and cancellation. */
(function() {
  'use strict';

  var crcTable = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }

  // Uncompressed ZIP keeps the implementation dependency-free. Reject ZIP64 sizes.
  function archive(entries) {
    var parts = [], central = [], offset = 0, centralSize = 0;
    if (entries.length > 65535) throw new Error('Too many entries for a ZIP archive.');
    entries.forEach(function(entry) {
      var name = unescape(encodeURIComponent(entry.name));
      var bytes = new Uint8Array(entry.data || 0);
      var crc = 0xffffffff;
      for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      if (name.length > 65535 || offset + bytes.length + name.length + 30 >= 0xffffffff) {
        throw new Error('Folder is too large for a ZIP archive.');
      }
      var local = new Uint8Array(30 + name.length);
      var header = new DataView(local.buffer);
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x800, true);
      header.setUint16(12, 33, true); // January 1, 1980
      header.setUint32(14, crc, true);
      header.setUint32(18, bytes.length, true);
      header.setUint32(22, bytes.length, true);
      header.setUint16(26, name.length, true);
      for (i = 0; i < name.length; i++) local[30 + i] = name.charCodeAt(i);
      var directory = new Uint8Array(46 + name.length);
      header = new DataView(directory.buffer);
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      directory.set(local.subarray(4, 30), 6);
      header.setUint32(42, offset, true);
      directory.set(local.subarray(30), 46);
      parts.push(local, bytes);
      central.push(directory);
      centralSize += directory.length;
      offset += local.length + bytes.length;
    });
    if (offset + centralSize >= 0xffffffff) throw new Error('Folder is too large for a ZIP archive.');
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), {type: 'application/zip'});
  }

  var downloads = Object.create(null);

  function render() {
    $('.button-save').each(function() {
      var button = $(this);
      var state = downloads[button.closest('tr').data('path')];
      var busy = state && state.busy;
      var status = busy ? 'busy' : state && state.done ? 'done' : state && state.failed ? 'failed' : 'idle';
      if (button.data('download-status') !== status) {
        button.data('download-status', status).toggle(!busy).empty().append($('<span>').addClass('glyphicon ' +
          (status === 'done' ? 'glyphicon-ok text-success' :
            status === 'failed' ? 'glyphicon-refresh' : 'glyphicon-download-alt')))
          .append(document.createTextNode(' Download'));
      }
      var controls = button.siblings('.download-active');
      if (busy) {
        if (!controls.length) {
          controls = $('<span class="download-active">').insertAfter(button);
          $('<button type="button" class="button-cancel-download" aria-label="Cancel download" title="Cancel download">')
            .append($('<span class="glyphicon glyphicon-remove" aria-hidden="true">')).appendTo(controls);
          var progress = $('<span class="progress">').prependTo(controls);
          $('<span class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">').appendTo(progress);
        }
        controls.find('.progress-bar').css('width', state.percent + '%')
          .attr('aria-valuenow', state.percent).text(state.label);
      } else {
        controls.remove();
      }
    });
  }

  $(function() {
    new MutationObserver(render).observe(document.getElementById('listing'), {childList: true});
  });

  $(document).on('click', '.button-cancel-download', function() {
    var state = downloads[$(this).closest('tr').data('path')];
    if (state && state.cancel) state.cancel();
  });

  $(document).on('click', '.button-save', function() {
    var item = $(this).closest('tr').data();
    if (downloads[item.path] && downloads[item.path].busy) return;
    var state = downloads[item.path] = {busy: true, percent: 0, label: 'Preparing…'};
    var active, cancelled = false, total = 0, completed = 0;
    var entries = [];
    state.cancel = function() {
      cancelled = true;
      if (active) active.abort();
      state.busy = false;
      render();
    };
    render();

    function request(url, binary, progress) {
      return new Promise(function(resolve, reject) {
        if (cancelled) return reject(new Error('Cancelled'));
        var xhr = active = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = binary ? 'arraybuffer' : 'json';
        xhr.onprogress = progress;
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
          else reject(new Error('Download failed (HTTP ' + xhr.status + ').'));
        };
        xhr.onerror = function() { reject(new Error('Connection lost.')); };
        xhr.onabort = function() { reject(new Error('Cancelled')); };
        xhr.send();
      });
    }

    function collect(path, name) {
      entries.push({name: name + '/'});
      return request('list?path=' + encodeURIComponent(path), false).then(function(items) {
        if (!Array.isArray(items)) throw new Error('Invalid directory response.');
        var chain = Promise.resolve();
        items.forEach(function(child) {
          chain = chain.then(function() {
            if (child.size == null) return collect(child.path, name + '/' + child.name);
            total += child.size;
            entries.push({name: name + '/' + child.name, path: child.path, size: child.size});
          });
        });
        return chain;
      });
    }

    function update(loaded, expected) {
      var percent = expected ? Math.min(100, Math.floor(loaded / expected * 100)) : 0;
      state.percent = percent;
      state.label = percent + '%';
      render();
    }

    var folder = item.size == null;
    var prepare = folder ? collect(item.path, item.name) : Promise.resolve();
    prepare.then(function() {
      if (!folder) {
        total = item.size;
        entries.push({path: item.path, name: item.name, size: item.size});
      }
      update(0, total);
      var chain = Promise.resolve();
      entries.forEach(function(entry) {
        if (!entry.path) return;
        chain = chain.then(function() {
          return request('download?path=' + encodeURIComponent(entry.path), true, function(event) {
            update(completed + event.loaded, total);
          }).then(function(data) {
            entry.data = data;
            completed += data.byteLength;
            update(completed, total);
          });
        });
      });
      return chain;
    }).then(function() {
      if (cancelled) return;
      state.percent = 100;
      state.label = folder ? 'Packing…' : 'Saving…';
      render();
      var blob = folder ? archive(entries) : new Blob([entries[0].data]);
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = item.name + (folder ? '.zip' : '');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
      state.busy = false;
      state.done = true;
      state.cancel = null;
      render();
    }).catch(function(error) {
      if (downloads[item.path] === state) {
        state.busy = false;
        state.failed = !cancelled;
        state.cancel = null;
        render();
      }
      if (!cancelled) _showError(error.message, 'Download', '');
    });
  });
})();
