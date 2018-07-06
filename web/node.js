
const getParams = function(query) {
    if (!query) return {};
    return (/^[?#]/.test(query) ? query.slice(1) : query)
        .split('&')
        .reduce((params, param) => {
            let [ key, value ] = param.split("=");
            params[key] = value ? decodeURIComponent(value.replace(/\+/g, " ")) : "";
            return params;
        }
    , {});
};

const colors = [
    { bg: "rgba(255, 99, 132, 0.2)", bdr: "rgba(255, 99, 132, 1.0)" },
    { bg: "rgba(54, 162, 235, 0.2)", bdr: "rgba(54, 162, 235, 1.0)" },
    { bg: "rgba(255, 206, 86, 0.2)", bdr: "rgba(255, 206, 86, 1.0)" },
    { bg: "rgba(75, 192, 192, 0.2)", bdr: "rgba(75, 192, 192, 1.0)" },
    { bg: "rgba(153, 102, 255, 0.2)", bdr: "rgba(153, 102, 255, 1.0)" },
    { bg: "rgba(255, 159, 64, 0.2)", bdr: "rgba(255, 159, 64, 1.0)" }
];

function showOptions(dimension, node) {
    const reports = $("#reports");

    // show the current dimension
    reports.html("");
    $("<span />").text(`by ${dimension}`).appendTo(reports);

    // add all possible
    $(`<a href="#" />`).text("name and file").click(function() {
        getByDimensions("name", "file", node);
        showOptions("name and file", node);
    }).appendTo(reports);
    $(`<a href="#" />`).text("name and config").click(function() {
        getByDimensions("name", "config", node);
        showOptions("name and config", node);
    }).appendTo(reports);
    $(`<a href="#" />`).text("config and name").click(function() {
        getByDimensions("config", "name", node);
        showOptions("config and name", node);
    }).appendTo(reports);
    $(`<a href="#" />`).text("config and file").click(function() {
        getByDimensions("config", "file", node);
        showOptions("config and file", node);
    }).appendTo(reports);
    $(`<a href="#" />`).text("file and name").click(function() {
        getByDimensions("file", "name", node);
        showOptions("file and name", node);
    }).appendTo(reports);
    $(`<a href="#" />`).text("file and config").click(function() {
        getByDimensions("file", "config", node);
        showOptions("file and config", node);
    }).appendTo(reports);

}

function getByDimensions(primary, secondary, node) {
    $.ajax({
        url: `/metrics/by/${primary}/${secondary}/${node}`
    }).then(function(charts, status, xhr) {

        // clear charts
        $("#charts").html("");

        // sort by volume, error, then everything else by name
        charts.sort(function(a, b) {
            if (a.name === "volume") {
                return -1;
            } else if (a.name === "errors") {
                return (b.name === "volume") ? 1 : -1;
            } else {
                return a.name.localeCompare(b.name);
            }
        });

        // create a series of charts
        for (const chart of charts) {

            // create the chart
            const container = $("<div />").appendTo("#charts");
            $("<h2 />").text(chart.name).appendTo(container);
            const div = $("<div />").addClass("chart").appendTo(container);
            const canvas = $("<canvas />").appendTo(div);
            const ctx = canvas.get(0).getContext("2d");

            // create the datasets
            const datasets = [];
            let color = 0;
            for (const series of chart.series) {
                console.log(color);
                console.log(colors[color].bg);
                datasets.push({
                    label: series.name,
                    data: series.data,
                    backgroundColor: colors[color].bg,
                    borderColor: colors[color].bdr,
                });
                color++;
                if (color >= colors.length) color = 0;
            }

            // render the chart
            new Chart(ctx, {
                type: "line",
                data: {
                    labels: chart.time,
                    datasets: datasets
                },
                options: {
                    maintainAspectRatio: false,
                    scales: {
                        xAxes: [{
                            type: "time",
                            display: true,
                            time: {
                                format: "YYYY-MM-DDTHH:mm:ssZ",
                                unit: "minute",
                                unitStepSize: 15
                            }
                        }]
                    },
                    pan: {
                        enabled: true,
                        mode: "x"
                    },
                    zoom: {
                        enabled: true,
                        mode: "x",
                    }
                }
            });

        }

    }, function(xhr, status, error) {
        $("#events").text(`${xhr.status}: ${error}`);
    });
}

$(document).ready(function() {
    const qs = getParams(window.location.search);
    $("#node").text(qs.node);
    showOptions("name and file", qs.node);
    getByDimensions("name", "file", qs.node);
});