
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

    // add the opposite as a link
    const opposite = (dimension === "name") ? "file" : "name";
    $(`<a href="#" />`).text(`view by ${opposite}`).click(function() {
        getByDimension(opposite, node);
        showOptions(opposite, node);
    }).appendTo(reports);

}

function getByDimension(dimension, node) {
    $.ajax({
        url: `/by-${dimension}/${node}`
    }).then(function(charts, status, xhr) {

        // clear charts
        $("#charts").html("");

        // sort by volume, error, then everything else by name
        charts.sort(function(a, b) {
            if (a.name === "__volume") {
                return -1;
            } else if (a.name === "__error") {
                return (b.name === "__volume") ? 1 : -1;
            } else {
                return a.name.localeCompare(b.name);
            }
        });

        // create a series of charts
        for (const chart of charts) {

            // create the chart
            const container = $("<div />").appendTo("#charts");
            const title = /^[_]*(?<name>.+)$/.exec(chart.name).groups.name;
            $("<h2 />").text(title).appendTo(container);
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
    showOptions("name", qs.node);
    getByDimension("name", qs.node);
});