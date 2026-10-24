/*
 Copyright (c) 2012-2019, Pierre-Olivier Latour
 All rights reserved.
 
 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:
 * Redistributions of source code must retain the above copyright
 notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in the
 documentation and/or other materials provided with the distribution.
 * The name of Pierre-Olivier Latour may not be used to endorse
 or promote products derived from this software without specific
 prior written permission.
 
 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 DISCLAIMED. IN NO EVENT SHALL PIERRE-OLIVIER LATOUR BE LIABLE FOR ANY
 DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

var ENTER_KEYCODE = 13;

var _path = null;
var _pendingReloads = [];
var _reloadingDisabled = 0;

function formatFileSize(bytes) {
  if (bytes >= 1000000000) {
    return (bytes / 1000000000).toFixed(2) + ' GB';
  }
  if (bytes >= 1000000) {
    return (bytes / 1000000).toFixed(2) + ' MB';
  }
  return (bytes / 1000).toFixed(2) + ' KB';
}

function _showError(message, textStatus, errorThrown) {
  $("#alerts").prepend(tmpl("template-alert", {
    level: "danger",
    title: (errorThrown != "" ? errorThrown : textStatus) + ": ",
    description: message
  }));
}

function _disableReloads() {
  _reloadingDisabled += 1;
}

function _enableReloads() {
  _reloadingDisabled -= 1;
  
  if (_pendingReloads.length > 0) {
    _reload(_pendingReloads.shift());
  }
}

function _reload(path) {
  if (_reloadingDisabled) {
    if ($.inArray(path, _pendingReloads) < 0) {
      _pendingReloads.push(path);
    }
    return;
  }
  
  _disableReloads();
  $.ajax({
    url: 'list',
    type: 'GET',
    data: {path: path},
    dataType: 'json'
  }).fail(function(jqXHR, textStatus, errorThrown) {
    _showError("Failed retrieving contents of \"" + path + "\"", textStatus, errorThrown);
  }).done(function(data, textStatus, jqXHR) {
    var scrollPosition = $(document).scrollTop();
    
    if (path != _path) {
      $("#path").empty();
      if (path == "/") {
        $("#path").append('<li class="active">' + _device + '</li>');
      } else {
        $("#path").append('<li data-path="/"><a>' + _device + '</a></li>');
        var components = path.split("/").slice(1, -1);
        for (var i = 0; i < components.length - 1; ++i) {
          var subpath = "/" + components.slice(0, i + 1).join("/") + "/";
          $("#path").append('<li data-path="' + subpath + '"><a>' + components[i] + '</a></li>');
        }
        $("#path > li").click(function(event) {
          _reload($(this).data("path"));
          event.preventDefault();
        });
        $("#path").append('<li class="active">' + components[components.length - 1] + '</li>');
      }
      _path = path;
    }
    
    $("#listing").empty();
    for (var i = 0, file; file = data[i]; ++i) {
      $(tmpl("template-listing", file)).data(file).appendTo("#listing");
    }
    
    $(".edit").editable(function(value, settings) { 
      var name = $(this).parent().parent().data("name");
      if (value != name) {
        var path = $(this).parent().parent().data("path");
        $.ajax({
          url: 'move',
          type: 'POST',
          data: {oldPath: path, newPath: _path + value},
          dataType: 'json'
        }).fail(function(jqXHR, textStatus, errorThrown) {
          _showError("Failed moving \"" + path + "\" to \"" + _path + value + "\"", textStatus, errorThrown);
        }).always(function() {
          _reload(_path);
        });
      }
      return value;
    }, {
      onedit: function(settings, original) {
        _disableReloads();
      },
      onsubmit: function(settings, original) {
        _enableReloads();
      },
      onreset: function(settings, original) {
        _enableReloads();
      },
      tooltip: 'Click to rename...'
    });
    
    $(".button-download").click(function(event) {
      var path = $(this).parent().parent().data("path");
      setTimeout(function() {
        window.location = "download?path=" + encodeURIComponent(path);
      }, 0);
    });
    
    $(".button-open").click(function(event) {
      var path = $(this).parent().parent().data("path");
      _reload(path);
    });
    
    $(".button-move").click(function(event) {
      var path = $(this).parent().parent().data("path");
      if (path[path.length - 1] == "/") {
        path = path.slice(0, path.length - 1);
      }
      $("#move-input").data("path", path);
      $("#move-input").val(path);
      $("#move-modal").modal("show");
    });
    
    $(".button-delete").click(function(event) {
      var path = $(this).parent().parent().data("path");
      $.ajax({
        url: 'delete',
        type: 'POST',
        data: {path: path},
        dataType: 'json'
      }).fail(function(jqXHR, textStatus, errorThrown) {
        _showError("Failed deleting \"" + path + "\"", textStatus, errorThrown);
      }).always(function() {
        _reload(_path);
      });
    });
    
    $(document).scrollTop(scrollPosition);
  }).always(function() {
    _enableReloads();
  });
}

$(document).ready(function() {
  function prepareFolderUploads(data) {
    var groups = data.folderGroups = Object.create(null);
    $.each(data.files, function(_, file) {
      var path = file.webkitRelativePath || (file.relativePath || '') + file.name;
      if (path.indexOf('/') < 0) return;
      var name = path.split('/')[0];
      var group = groups[name] || (groups[name] = {
        name: name, total: 0, loaded: 0, pending: 0, failed: 0, cancelled: false, cancels: []
      });
      group.total += file.size || 0;
      group.pending++;
    });
    data.uploadBasePath = _path;
  }

  function finishUpload(data) {
    if (data.uploadFinished) return;
    data.uploadFinished = true;
    var group = data.folderGroup;
    if (group) {
      group.pending--;
      if (!group.pending && !group.cancelled) {
        group.context.remove();
      }
    } else {
      data.context.remove();
    }
    $('.uploading').toggle($('#uploads').children().length > 0);
  }
  
  $("#upload-file").click(function(event) {
    event.preventDefault();
    document.getElementById('fileupload').click();
  });
  
  // Prevent event bubbling when using workaround above
  $("#fileupload").click(function(event) {
    event.stopPropagation();
  });

  $("#upload-folder").click(function(event) {
    event.preventDefault();
    document.getElementById('folderupload').click();
  });

  $("#folderupload").change(function() {
    var files = Array.prototype.slice.call(this.files || []);
    var base = _path;
    this.value = '';
    if (!files.length) {
      _showError('The selected folder contains no files.', 'Upload', '');
      return;
    }
    var data = {files: files, uploadBasePath: base};
    prepareFolderUploads(data);
    $("#fileupload").fileupload('add', data);
  });
  
  $("#fileupload").fileupload({
    dropZone: $(document),
    pasteZone: null,
    autoUpload: true,
    sequentialUploads: true,
    // limitConcurrentUploads: 2,
    // forceIframeTransport: true,
    
    url: 'upload',
    type: 'POST',
    dataType: 'json',
    change: function(e, data) {
      prepareFolderUploads(data);
    },
    drop: function(e, data) {
      prepareFolderUploads(data);
    },
    
    start: function(e) {
      $(".uploading").show();
    },
    
    stop: function(e) {
      $(".uploading").toggle($("#uploads").children().length > 0);
    },
    
    add: function(e, data) {
      var file = data.files[0];
      var relativePath = file.webkitRelativePath || (file.relativePath || '') + file.name;
      var components = relativePath.split('/');
      components.pop();
      var base = data.uploadBasePath || _path;
      var destination = base + (components.length ? components.join('/') + '/' : '');
      var group = data.folderGroup = components.length && data.folderGroups && data.folderGroups[components[0]];
      if (group && group.cancelled) return;
      data.formData = {
        path: destination
      };
      if (group) {
        if (!group.context) {
          group.context = $(tmpl('template-uploads', {path: group.name})).appendTo('#uploads');
          group.context.find('.column-path p').prepend($('<span class="glyphicon glyphicon-folder-close" aria-hidden="true">'), ' ');
          group.context.find('button').on('click', function() {
            group.cancelled = true;
            $.each(group.cancels, function(_, cancel) { cancel(); });
            group.context.remove();
            $('.uploading').toggle($('#uploads').children().length > 0);
          });
        }
        data.context = group.context;
      } else {
        data.context = $(tmpl('template-uploads', {path: base + relativePath})).appendTo('#uploads');
      }
      $(".uploading").show();
      var jqXHR;
      var createRequest;
      if (components.length) {
        createRequest = $.ajax({
          url: 'create',
          type: 'POST',
          data: {path: destination, recursive: true},
          dataType: 'json'
        }).done(function() {
          jqXHR = data.submit();
        }).fail(function(request, textStatus, errorThrown) {
          if (textStatus != 'abort') {
            _showError('Failed creating folder "' + destination + '"', textStatus, errorThrown);
          }
          if (group && textStatus != 'abort') group.failed++;
          finishUpload(data);
        });
      } else {
        jqXHR = data.submit();
      }
      var cancel = function() {
        if (createRequest) {
          createRequest.abort();
        }
        if (jqXHR) {
          jqXHR.abort();
        }
      };
      if (group) group.cancels.push(cancel);
      else data.context.find('button').click(cancel);
    },
    
    progress: function(e, data) {
      var progress = parseInt(data.loaded / data.total * 100, 10);
      var group = data.folderGroup;
      if (group) {
        var loaded = (data.files[0].size || 0) * Math.min(1, data.loaded / (data.total || 1));
        group.loaded += loaded - (data.folderLoaded || 0);
        data.folderLoaded = loaded;
        progress = group.total ? Math.floor(group.loaded / group.total * 100) : 0;
        progress = Math.min(99, progress);
      }
      data.context.find(".progress-bar").css("width", progress + "%");
      if (group) data.context.find('.progress-bar').text(progress + '%');
    },
    
    done: function(e, data) {
      _reload(_path);
    },
    
    fail: function(e, data) {
      var file = data.files[0];
      if (data.errorThrown != "abort") {
        if (data.folderGroup) data.folderGroup.failed++;
        _showError("Failed uploading \"" + file.name + "\" to \"" + _path + "\"", data.textStatus, data.errorThrown);
      }
    },
    
    always: function(e, data) {
      finishUpload(data);
    },
    
  });

  
  $("#create-input").keypress(function(event) {
    if (event.keyCode == ENTER_KEYCODE) {
      $("#create-confirm").click();
    };
  });
  
  $("#create-modal").on("shown.bs.modal", function(event) {
    $("#create-input").focus();
    $("#create-input").select();
  });
  
  $("#create-folder").click(function(event) {
    $("#create-input").val("Untitled folder");
    $("#create-modal").modal("show");
  });
  
  $("#create-confirm").click(function(event) {
    $("#create-modal").modal("hide");
    var name = $("#create-input").val();
    if (name != "") {
      $.ajax({
        url: 'create',
        type: 'POST',
        data: {path: _path + name},
        dataType: 'json'
      }).fail(function(jqXHR, textStatus, errorThrown) {
        _showError("Failed creating folder \"" + name + "\" in \"" + _path + "\"", textStatus, errorThrown);
      }).always(function() {
        _reload(_path);
      });
    }
  });
  
  $("#move-input").keypress(function(event) {
    if (event.keyCode == ENTER_KEYCODE) {
      $("#move-confirm").click();
    };
  });
  
  $("#move-modal").on("shown.bs.modal", function(event) {
    $("#move-input").focus();
    $("#move-input").select();
  })
  
  $("#move-confirm").click(function(event) {
    $("#move-modal").modal("hide");
    var oldPath = $("#move-input").data("path");
    var newPath = $("#move-input").val();
    if ((newPath != "") && (newPath[0] == "/") && (newPath != oldPath)) {
      $.ajax({
        url: 'move',
        type: 'POST',
        data: {oldPath: oldPath, newPath: newPath},
        dataType: 'json'
      }).fail(function(jqXHR, textStatus, errorThrown) {
        _showError("Failed moving \"" + oldPath + "\" to \"" + newPath + "\"", textStatus, errorThrown);
      }).always(function() {
        _reload(_path);
      });
    }
  });
  
  $("#reload").click(function(event) {
    _reload(_path);
  });
  
  _reload("/");
  
});
