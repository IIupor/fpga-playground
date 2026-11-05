module sta_smoke (
    input  wire clk,
    input  wire a,
    input  wire b,
    output wire y
);
    reg q;

    always @(posedge clk)
        q <= a & b;

    assign y = q;
endmodule
