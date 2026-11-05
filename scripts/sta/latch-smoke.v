module fpga_playground (
    input wire D,
    input wire EN,
    output wire Q
);
    sky130_fd_sc_hd__dlxtp_1 LATCH1 (
        .D(D),
        .GATE(EN),
        .Q(Q)
    );
endmodule
