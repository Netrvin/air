"use strict";

var noField = false;

var π = Math.PI;
var log = {
    debug:   function(s) { console.log(s); },
    info:    function(s) { console.info(s); },
    error:   function(e) { console.error(e.stack ? e.stack : e); },
    time:    function(s) { console.time(s); },
    timeEnd: function(s) { console.timeEnd(s); }
}

/**
 * Returns an object {width:, height:} for the size of the browser's view.
 */
function viewPort() {
    var w = window, d = document.documentElement, b = document.getElementsByTagName('body')[0];
    var x = w.innerWidth || d.clientWidth || b.clientWidth;
    var y = w.innerHeight || d.clientHeight || b.clientHeight;
    return {width: x, height: y};
}

/**
 * Returns a human readable string of the provided coordinates.
 */
function formatCoordinates(lng, lat) {
    return Math.abs(lat).toFixed(6) + "º " + (lat >= 0 ? "N" : "S") + ", " +
           Math.abs(lng).toFixed(6) + "º " + (lng >= 0 ? "E" : "W");
}

/**
 * Returns an Albers conical projection (en.wikipedia.org/wiki/Albers_projection) that maps the bounding box
 * onto the view port having (0, 0) as the upper left point and (width, height) as the lower right point.
 */
function createProjection(boundingBox, width, height) {
    var lng0 = boundingBox[0];  // lower left longitude
    var lat0 = boundingBox[1];  // lower left latitude
    var lng1 = boundingBox[2];  // upper right longitude
    var lat1 = boundingBox[3];  // upper right latitude

    // Construct a unit projection centered on the bounding box. NOTE: calculation of the center will not
    // be correct if the bounding box crosses the 180th meridian. But don't expect that to happen...
    var projection = d3.geo.albers()
        .rotate([-((lng0 + lng1) / 2), 0]) // rotate the globe from the prime meridian to the bounding box's center.
        .center([0, (lat0 + lat1) / 2])    // set the globe vertically on the bounding box's center.
        .scale(1)
        .translate([0, 0]);

    // Project the two longitude/latitude points into pixel space. These will be tiny because scale is 1.
    var p0 = projection([lng0, lat0]);
    var p1 = projection([lng1, lat1]);
    // The actual scale is the ratio between the size of the bounding box in pixels and the size of the view port.
    // Reduce by 5% for a nice border.
    var s = 1 / Math.max((p1[0] - p0[0]) / width, (p0[1] - p1[1]) / height) * 0.95;
    // Move the center to (0, 0) in pixel space.
    var t = [width / 2, height / 2];

    return projection.scale(s).translate(t);
}

/**
 * Returns a promise for a JSON resource (URL) fetched via XHR.
 */
function loadJson(resource) {
    var d = when.defer();
    d3.json(resource, function(error, result) {
        return error ? d.reject(error) : d.resolve(result);
    });
    return d.promise;
}

//var resource = "samples/2013/8/24/16"
//var resource = "samples/2013/8/21/15"
//var resource = "samples/2013/8/20/22"
//var resource = "samples/2013/8/20/20"
//var resource = "samples/2013/8/20/18"
//var resource = "samples/2013/8/18/17"  // strong northerly wind
//var resource = "samples/2013/8/16/15"
//var resource = "samples/2013/8/12/19"  // max wind at one station
//var resource = "samples/2013/8/27/12"  // gentle breeze
//var resource = "samples/2013/8/26/29"
//var resource = "samples/2013/8/30/11" // wind reversal in west, but IDW doesn't see it
//var resource = "samples/2013/9/1/17"  // spiral over tokyo -- moved
var resource = "samples/2013/9/1/16"  // spiral over tokyo ++
//var resource = "samples/current";

var topoTask = loadJson("tokyo-topo.json");
var dataTask = loadJson(resource);

function masker(renderTask) {
    if (noField) return when.resolve("no");
    return renderTask.then(function(canvas) {
        var data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        var width = canvas.width;
        return function(x, y) {
            var i = (y * width + x) * 4;
            return data[i] > 0;
        }
    });
}


var view = viewPort();
var width = view.width, height = view.height;

var projection;  // ugh. global to this script, but assigned asynchronously
var done = false;

var mapSvg = d3.select("#map-svg").attr("width", width).attr("height", height);
var fieldCanvas = d3.select("#field-canvas").attr("width", width).attr("height", height)[0][0];

var c = fieldCanvas;
var g = c.getContext("2d");

d3.select("#field-canvas").on("click", displayCoordinates);

function render(width, height, appendTo) {
    var d = when.defer();

    if (noField) { d.resolve("no"); return d.promise; }

    setTimeout(function() {
        log.time("rendering canvas");

        var div = document.createElement("div");
        var svg = document.createElement("svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        div.appendChild(svg);

        appendTo(d3.select(svg));

        var canvas = document.createElement("canvas");
        canvas.setAttribute("width", width);
        canvas.setAttribute("height", height);
        canvg(canvas, div.innerHTML.trim());

        log.timeEnd("rendering canvas");
        d.resolve(canvas);
    }, 25);
    return d.promise;
}

function plotCurrentPosition(svg, projection) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                var p = projection([position.coords.longitude, position.coords.latitude]);
                var x = Math.round(p[0]);
                var y = Math.round(p[1]);
                if (0 <= x && x < width && 0 <= y && y < height) {
                    svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 3).attr("id", "pos");
                }
            },
            log.error,
            {enableHighAccuracy: true});
    }
}

topoTask.then(doProcess).then(null, log.error);

function doProcess(topo) {
    log.time("building meshes");

    projection = createProjection(topo.bbox, view.width, view.height);

    var path = d3.geo.path().projection(projection);
    var outerBoundary = topojson.mesh(topo, topo.objects.tk, function(a, b) { return a === b; });
    var divisionBoundaries = topojson.mesh(topo, topo.objects.tk, function (a, b) { return a !== b; });

    log.timeEnd("building meshes");

    log.time("rendering map");
    mapSvg.append("path")
        .datum(outerBoundary)
        .attr("class", "tk-outboundary")
        .attr("d", path);
    mapSvg.append("path")
        .datum(divisionBoundaries)
        .attr("class", "tk-inboundary")
        .attr("d", path);
    log.timeEnd("rendering map");

    var displayMaskTask = masker(
        render(width, height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", "2")
                .attr("stroke", "#000")
                .attr("d", path);
        }));

    var fieldMaskTask = masker(
        render(width, height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", "30")  // FF does NOT like a large number here--even canvg is slow
                .attr("stroke", "#fff")// Also, the stroke-width should scale with canvas size
                .attr("d", path);
        }));

    plotCurrentPosition(mapSvg, projection);

    dataTask.then(function(data) {
        var features = data[Object.keys(data)[0]].map(function(e) {  // UNDONE: object.keys(data)[0] is annoying
            return {
                type: "Features",
                properties: {name: e.stationId.toString()},
                geometry: {type: "Point", coordinates: e.coordinates}};
        });
        path.pointRadius(1);
        mapSvg.append("path")
            .datum({type: "FeatureCollection", features: features})
            .attr("class", "station")
            .attr("d", path);
    }).then(null, log.error);

    interpolateVectorField(displayMaskTask, fieldMaskTask)
        .then(processVectorField)
        .then(null, log.error);
}

function displayCoordinates() {
    var c = projection.invert(d3.mouse(this));
    document.getElementById("location").textContent = "⁂ " + formatCoordinates(c[0], c[1]);
    done = true;
}

function displayTimestamp(isoDate) {
    document.getElementById("date").textContent = "⁂ " + isoDate;
}

function kdTree(stations, depth) {
    if (stations.length == 0) {
        return null;
    }
    var axis = depth % 2;
    var compareByAxis = function(a, b) {
        return a.point[axis] - b.point[axis];
    }
    stations.sort(compareByAxis);

    // Pivot where all stations to the left are _strictly smaller_ than the median.
    var median = Math.floor(stations.length / 2);
    var pivot = stations[median];
    // Scan backwards for stations aligned on the same axis. We want to be at the beginning of any such sequence.
    while (median > 0 && compareByAxis(pivot, stations[median - 1]) === 0) {
        pivot = stations[--median];
    }

    var plane = pivot.point[axis];
    pivot.planeDistance = function(p) { return plane - p[axis]; };
    pivot.left = kdTree(stations.slice(0, median), depth + 1);
    pivot.right = kdTree(stations.slice(median + 1), depth + 1);
    return pivot;
}

function heapify(a, i, key) {
    var length = a.length;
    var child;
    while ((child = i * 2 + 1) < length) {
        var favorite = a[child];
        var right = child + 1;
        var r;
        if (right < length && (r = a[right]).distance2 > favorite.distance2) {
            favorite = r;
            child = right;
        }
        if (key.distance2 >= favorite.distance2) {
            break;
        }
        a[i] = favorite;
        i = child;
    }
    a[i] = key;
}

/**
 * Returns the square of the distance between the two specified points [x0, y0] and [x1, y1].
 */
function distance2(p0, p1) {
    var Δx = p0[0] - p1[0];
    var Δy = p0[1] - p1[1];
    return Δx * Δx + Δy * Δy;
}

function nearest(point, node, best) {
    var planeDistance = node.planeDistance(point);
    var side;
    var otherSide;
    if (planeDistance <= 0) {
        side = node.right;
        otherSide = node.left;
    }
    else {
        side = node.left;
        otherSide = node.right;
    }

    if (side) {
        nearest(point, side, best);
    }
    var d2 = distance2(point, node.point);
    var x = best[0];
    if (d2 < x.distance2) {
        x.distance2 = d2;
        x.station = node;
        heapify(best, 0, x);
    }

    if (otherSide) {
        if ((planeDistance * planeDistance) < best[0].distance2) {
            nearest(point, otherSide, best);
        }
    }
}

function vectorScale(v, s) {
    v[0] *= s;
    v[1] *= s;
    return v;
}

function vectorAdd(a, b) {
    a[0] = a[0] + b[0];
    a[1] = a[1] + b[1];
    return a;
}

// HACKS
var temp = [];
var closest = [];
for (var i = 0; i < 5; i++) {
    closest.push({});
}

function f(x, y, initial, root) {
    var n = initial;
    var d = 0;
    var i;
    for (i = 0; i < closest.length; i++) {
        var ee = closest[i];
        ee.station = null;
        ee.distance2 = Infinity;
    }

    temp[0] = x;
    temp[1] = y;
    nearest(temp, root, closest);

    for (i = 0; i < closest.length; i++) {
        var e = closest[i];
        var w = 1 / e.distance2;
        if (w === Infinity) {  // (x, y) is the same point as the sample.
            return value;
        }
        var sample = e.station.sample;
        temp[0] = sample[0];  // DOESN'T WORK FOR SCALARS
        temp[1] = sample[1];
        var s = vectorScale(temp, w);
        n = vectorAdd(n, s);
        d += w;
    }

    return vectorScale(n, 1 / d);
}

function randomPoint(field) {
    var x;
    var y;
    var i = 30;
    do {
        x = Math.floor(Math.random() * (width - 1));
        y = Math.floor(Math.random() * (height - 1));
        if (--i == 0) {  // UNDONE: remove this check. make better.
            log.debug("hrm");
            return [Math.floor(width / 2), Math.floor(height / 2)];
        }
    } while (!noField && vectorAt(field, x, y) === noVector);
    return [x, y];
}

var noVector = [0, 0, -1];

function polarToRectangular(v) {
    var wd_deg = v[0] + 180;  // convert into-the-wind cardinal degrees to with-the-wind
    var cr = wd_deg / 180 * π;  // convert to cardinal radians
    var wd_rad = Math.atan2(Math.cos(cr), Math.sin(cr));  // wind direction in standard radians
    var wv = v[1];  // wind velocity
    var x = Math.cos(wd_rad) * wv;
    var y = -Math.sin(wd_rad) * wv;  // negate along y axis because pixel space increases downwards
    return [x, y];
}

function interpolateVectorField(displayMaskTask, fieldMaskTask) {
    var d = when.defer();

    when.all([dataTask, displayMaskTask, fieldMaskTask]).then(function(results) {
        log.time("interpolating field");
        // Convert cardinal (north origin, clockwise) to radians (counter-clockwise)
        var samples = results[0];
        var displayMask = results[1];
        var fieldMask = results[2];

        var date = Object.keys(samples)[0];
        displayTimestamp(date);

        if (noField) { d.resolve([]); return d.promise; }

        var stations = [];
        samples[date].forEach(function(station) {
            if (station.wind[0] && station.wind[1]) {
                station.point = projection(station.coordinates);
                station.sample = polarToRectangular(station.wind);
                stations.push(station);
            }
        });

        var root = kdTree(stations, 0);

        var field = [];
        for (var x = 0; x < width; x++) {
            var column = field[x] = [];
            for (var y = 0; y < height; y++) {
                var v = noVector;
                if (fieldMask(x, y)) {
                    v = f(x, y, [0, 0, 0], root);
                    v[2] = displayMask(x, y) ? Math.sqrt(v[0]*v[0] + v[1]*v[1]) : -1;
                }
                column[y] = v;
            }
        }
        d.resolve(field);
        log.timeEnd("interpolating field");
    }).then(null, log.error);

    return d.promise;
}

function vectorAt(field, x, y) {
    var column = field[x];
    if (column) {
        var v = column[y];
        if (v) {
            return v;
        }
    }
    return noVector;
}

function processVectorField(field) {
    var particles = [];
    var maxAge = 30;

    for (var i = 0; i < 5000; i++) {
        var p = randomPoint(field);
        particles.push({
            x: p[0],
            y: p[1],
            age: Math.floor(Math.random() * maxAge),
            fx: 0,
            fy: 0,
            fxt: 0,
            fyt: 0
        });
    }

    var styles = [];
    for (var j = 75; j <= 255; j += 6) {
        styles.push("rgba(" + j + ", " + j + ", " + j + ", 1)");
    }
    var max = 17;
    var min = 0;
    var range = max - min;

    draw();

    function draw() {
        var prev = g.globalCompositeOperation;
        g.fillStyle = "rgba(0, 0, 0, 0.93)";
        g.globalCompositeOperation = "destination-in";
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = prev;

        if (noField) return;

        g.lineWidth = 0.75;
        var buckets = [];
        for (var i = 0; i < styles.length; i++) {
            buckets[i] = [];
        }

        particles.forEach(function(particle) {
            if (particle.age > maxAge) {
                particle.age = 0;
                var p = randomPoint(field);
                particle.x = p[0];
                particle.y = p[1];
            }

            // get vector at current location
            var x = particle.x;
            var y = particle.y;
            var fx = Math.round(x);
            var fy = Math.round(y);

            var v = vectorAt(field, fx, fy);
            if (v !== noVector) {
                var xt = x + v[0];
                var yt = y + v[1];
                var fxt = Math.round(xt);
                var fyt = Math.round(yt);
                var m = v[2];

                if (m >= 0 && vectorAt(field, fxt, fyt)[2] >= 0) {
                    var i = Math.floor((Math.min(m, max) - min) / range * (styles.length - 1));
                    particle.fx = fx;
                    particle.fy = fy;
                    particle.fxt = fxt;
                    particle.fyt = fyt;
                    buckets[i].push(particle);
                }
                particle.x = xt;
                particle.y = yt;
            }
            particle.age += 1;
        });

        buckets.forEach(function(bucket, i) {
            if (bucket.length > 0) {
                g.beginPath();
                g.strokeStyle = styles[i];
                bucket.forEach(function(particle) {
//                    g.fillStyle = styles[i]; //"rgba(255, 255, 255, 1)";
//                    g.fillRect(particle.fxt, particle.fyt, 1, 1);
                    g.moveTo(particle.fx, particle.fy);
                    g.lineTo(particle.fxt, particle.fyt);
                })
                g.stroke();
            }
        });

        if (!done) {
            setTimeout(draw, 35);
        }
    }
}
