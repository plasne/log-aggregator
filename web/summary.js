
function getSummary() {
    $.ajax({
        url: "/summary"
    }).then(function(summary, status, xhr) {

        // show the agents
        if (summary.nodes.length > 0) {
            const last = summary.nodes[summary.nodes.length - 1];
            for (const node of summary.nodes) {
                const spacer = (node !== last) ? ", " : "";
                const div = $("<div />").appendTo("#nodes");
                $("<a />").text(node.name).attr("href", `/node.html?node=${node.name}`).appendTo(div);
                $("<span />").text(` (volume: ${node.logsLastHour}, errors: ${node.errorsLastHour})${spacer}`).appendTo(div);
            }
        }

        // draw the chart
        const ctx = $("#volume-chart").get(0).getContext("2d");
        new Chart(ctx, {
            type: "line",
            data: {
                labels: summary.chart.time,
                datasets: [
                    {
                        label: "log volume",
                        data: summary.chart.series[0].data,
                        borderColor: "#006600",
                        backgroundColor: "#AACCAA"
                    },
                    {
                        label: "errors",
                        data: summary.chart.series[1].data,
                        borderColor: "#660000",
                        backgroundColor: "#CCAAAA"
                    }
                ]
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

    }, function(xhr, status, error) {
        $("#events").text(`${xhr.status}: ${error}`);
    });
}

$(document).ready(function() {
    getSummary();
});