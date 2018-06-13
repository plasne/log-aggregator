
$(document).ready(function() {

    $.ajax({
        url: "/summary"
    }).then(function(summary, status, xhr) {

        // show the agents
        if (summary.nodes.length > 0) {
            const last = summary.nodes[summary.nodes.length - 1];
            for (const node of summary.nodes) {
                const spacer = (node !== last) ? ", " : "";
                const div = $("<div></div>").text(node.name + spacer);
                div.appendTo("#nodes");
            }
        }

        // show the chart
        const ctx = $("#myChart").get(0).getContext("2d");
        const myChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: summary.volume.time,
                datasets: [
                    {
                        label: "log volume",
                        data: summary.volume.data,
                        borderColor: "#006600",
                        backgroundColor: "#AACCAA"
                    }
                ]
            },
            options: {
                maintainAspectRatio: false
            }
        });

    }, function(xhr, status, error) {

    });
});